// api/zr-webhook.js
// Receives real-time parcel state updates from ZR Express via Svix webhooks.
// Verifies the Svix signature, maps ZR state names to ARCO statuses,
// and updates the corresponding order in Supabase.
//
// Register this URL in ZR Express dashboard:
//   https://arco-art.store/api/zr-webhook
// Subscribe to:  parcel.state.updated, parcel.state.situation.created, parcel.isReturn.updated

import { createClient } from "@supabase/supabase-js";
import { mapZRState } from "./_zr.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WEBHOOK_SECRET = process.env.ZR_WEBHOOK_SECRET; // whsec_xxx from ZR dashboard

// Svix signature verification (no SDK needed — pure crypto)
async function verifySvixSignature(rawBody, headers) {
  if (!WEBHOOK_SECRET) return true; // skip verification if secret not yet configured

  const msgId        = headers["svix-id"];
  const msgTimestamp = headers["svix-timestamp"];
  const msgSignature = headers["svix-signature"];

  if (!msgId || !msgTimestamp || !msgSignature) return false;

  // Reject messages older than 5 minutes
  const ts = parseInt(msgTimestamp, 10);
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const toSign    = `${msgId}.${msgTimestamp}.${rawBody}`;
  const secret    = WEBHOOK_SECRET.startsWith("whsec_")
    ? WEBHOOK_SECRET.slice(6)
    : WEBHOOK_SECRET;
  const keyBytes  = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  const msgBytes  = new TextEncoder().encode(toSign);

  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  const computed = "v1," + btoa(String.fromCharCode(...new Uint8Array(sig)));

  // msgSignature may contain multiple space-separated sigs (e.g. "v1,abc v1,def")
  const provided = msgSignature.split(" ");
  return provided.some(s => s === computed);
}

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const rawBody = await readRawBody(req);

  // Verify signature
  const valid = await verifySvixSignature(rawBody, req.headers);
  if (!valid) {
    console.warn("[zr-webhook] Invalid signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { eventType, data } = event;

  console.log(`[zr-webhook] ${eventType} — parcel ${data?.id || "?"}`);

  // We handle all three event types — the key info is always data.state.name
  if (!["parcel.state.updated", "parcel.state.situation.created", "parcel.isReturn.updated"].includes(eventType)) {
    return res.status(200).json({ received: true, skipped: "unknown event type" });
  }

  const parcelId  = data?.id;
  const externalId = data?.externalId; // this is the order.order_id we sent
  const stateName  = data?.state?.name;
  const isReturn   = data?.isReturn;

  if (!parcelId && !externalId) {
    return res.status(200).json({ received: true, skipped: "no parcel identifier" });
  }

  // ── Find the order in Supabase by tracking number (parcelId) or externalId ──
  let order = null;

  if (parcelId) {
    const { data: rows } = await supabase
      .from("orders")
      .select("id, order_id, status, shipping_agency")
      .eq("tracking_number", parcelId)
      .limit(1);
    order = rows?.[0] || null;
  }

  if (!order && externalId) {
    const { data: rows } = await supabase
      .from("orders")
      .select("id, order_id, status, shipping_agency")
      .eq("order_id", externalId)
      .limit(1);
    order = rows?.[0] || null;
  }

  if (!order) {
    console.warn(`[zr-webhook] Order not found — parcelId: ${parcelId}, externalId: ${externalId}`);
    return res.status(200).json({ received: true, skipped: "order not found" });
  }

  // Only process ZR orders
  if (order.shipping_agency && order.shipping_agency !== "zr") {
    return res.status(200).json({ received: true, skipped: "not a ZR order" });
  }

  // ── Map ZR state → ARCO status ───────────────────────────────────────────
  let newStatus = null;

  if (eventType === "parcel.isReturn.updated" && isReturn === true) {
    newStatus = "not_delivered";
  } else if (stateName) {
    newStatus = mapZRState(stateName);
  }

  if (!newStatus || newStatus === order.status) {
    return res.status(200).json({ received: true, skipped: "no status change" });
  }

  // ── Update order status ──────────────────────────────────────────────────
  const timestamp = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: newStatus, updated_at: timestamp })
    .eq("id", order.id);

  if (updateError) {
    console.error("[zr-webhook] DB update error:", updateError);
    return res.status(500).json({ error: "DB update failed" });
  }

  // Log to order_history
  await supabase.from("order_history").insert({
    order_id:   order.order_id,
    old_status: order.status,
    new_status: newStatus,
    changed_by: "zr_webhook",
    changed_at: timestamp,
  });

  console.log(`[zr-webhook] ✅ Order ${order.order_id}: ${order.status} → ${newStatus} (ZR state: "${stateName}")`);

  // Fire delivered notification
  if (newStatus === "delivered") {
    try {
      await fetch("https://ntfy.sh/arco-delivered", {
        method: "POST",
        headers: { Title: "✅ Order Delivered", Priority: "high", Tags: "white_check_mark" },
        body: `${order.order_id} — via ZR Express`,
      });
    } catch {}
  }

  return res.status(200).json({ received: true, updated: true, newStatus });
}
