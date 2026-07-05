// api/ship-order-zr.js
// Ships a single confirmed order via ZR Express.

import { requireRole } from "./_auth.js";
import {
  zrPost, findWilayaId, findCommuneId,
  buildZRPayload, updateSupabase, logHistory,
} from "./zr.js";

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireRole(req, ["operator", "admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { orderId, order, hubId } = req.body || {};
  if (!orderId || !order)
    return res.status(400).json({ error: "Missing orderId or order data" });

  if (!process.env.ZR_API_KEY || !process.env.ZR_TENANT_ID)
    return res.status(500).json({ error: "ZR Express credentials not configured" });

  // ── Resolve territory UUIDs ──────────────────────────────────────────────
  const isPickup = order.type_livraison === "pickup";
  let wilayaId  = null;
  let communeId = null;

  if (!isPickup) {
    wilayaId = await findWilayaId(order.wilaya);
    if (!wilayaId)
      return res.status(400).json({
        error: `Unknown wilaya: "${order.wilaya}". Edit the order and fix the wilaya first.`,
      });

    if (order.commune) {
      communeId = await findCommuneId(wilayaId, order.commune);
      // commune not found is non-fatal — ZR accepts without it
    }
  }

  if (isPickup && !hubId && !order.station_code)
    return res.status(400).json({ error: "Stop desk (hubId) required for pickup orders." });

  // ── Build & send ─────────────────────────────────────────────────────────
  const payload = buildZRPayload({
    order,
    orderId,
    wilayaId,
    communeId,
    hubId: hubId || order.station_code || null,
  });

  const r = await zrPost("/parcels", payload);

  if (!r.ok || !r.data?.id) {
    console.error("ZR create error:", { status: r.status, orderId, response: r.data });
    const errMsg = extractZRError(r.data);
    return res.status(400).json({
      error:        errMsg,
      zr_status:    r.status,
      zr_response:  r.data,
    });
  }

  const trackingNumber = r.data.id; // ZR returns the parcel UUID as tracking ID

  await updateSupabase(orderId, {
    status:          "shipped",
    tracking_number: trackingNumber,
    shipping_agency: "zr",
  });

  await logHistory(
    order.order_id,
    "confirmed",
    "shipped",
    auth.role?.name || auth.role?.email || auth.user?.email || "operator"
  );

  return res.status(200).json({ success: true, tracking_number: trackingNumber });
}

function extractZRError(data) {
  if (!data) return "ZR Express create failed";
  if (data.detail) return String(data.detail);
  if (data.title)  return String(data.title);
  if (Array.isArray(data.errors) && data.errors.length)
    return data.errors.map(e => e.description || e.code || JSON.stringify(e)).join(" | ");
  return JSON.stringify(data);
}
