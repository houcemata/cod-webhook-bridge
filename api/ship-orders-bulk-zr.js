// api/ship-orders-bulk-zr.js
// Ships up to 100 confirmed orders at once via ZR Express bulk endpoint.

import { requireRole } from "./_auth.js";
import {
  zrPost, findWilayaId, findCommuneId,
  buildZRPayload, updateSupabase, logHistory,
} from "./zr.js";

function changedByOf(auth) {
  return auth.role?.name || auth.role?.email || auth.user?.email || auth.role?.role || "operator";
}

function extractZRError(data) {
  if (!data) return "ZR Express create failed";
  if (data.detail) return String(data.detail);
  if (data.title)  return String(data.title);
  if (Array.isArray(data.errors) && data.errors.length)
    return data.errors.map(e => e.description || e.code || JSON.stringify(e)).join(" | ");
  return JSON.stringify(data);
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireRole(req, ["operator", "admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { orders } = req.body || {};
  if (!Array.isArray(orders) || !orders.length)
    return res.status(400).json({ error: "No orders provided" });

  if (!process.env.ZR_API_KEY || !process.env.ZR_TENANT_ID)
    return res.status(500).json({ error: "ZR Express credentials not configured" });

  const results  = {};   // orderId → { success, tracking_number } | { error }
  const valid    = [];   // orders with resolved payloads

  // ── 1) Validate + build payloads ─────────────────────────────────────────
  for (const item of orders) {
    const { orderId, order, hubId } = item || {};
    if (!orderId || !order) {
      if (orderId) results[orderId] = { error: "Missing order data" };
      continue;
    }

    const isPickup = order.type_livraison === "pickup";
    let wilayaId  = null;
    let communeId = null;

    if (!isPickup) {
      wilayaId = await findWilayaId(order.wilaya);
      if (!wilayaId) {
        results[orderId] = { error: `Unknown wilaya: "${order.wilaya}"` };
        continue;
      }
      if (order.commune) {
        communeId = await findCommuneId(wilayaId, order.commune);
      }
    }

    const payload = buildZRPayload({
      order,
      orderId,
      wilayaId,
      communeId,
      hubId: hubId || order.station_code || null,
    });

    valid.push({ orderId, order, payload });
  }

  if (!valid.length) {
    return res.status(400).json({ results, shipped: 0, total: orders.length });
  }

  // ── 2) Send in chunks of 100 (ZR bulk limit) ─────────────────────────────
  const CHUNK    = 100;
  const toUpdate = [];

  for (let i = 0; i < valid.length; i += CHUNK) {
    const slice = valid.slice(i, i + CHUNK);

    const r = await zrPost("/parcels/bulk", {
      parcels: slice.map(v => v.payload),
    });

    // ZR bulk returns 200/207/400
    // successes: [{ externalId, trackingNumber, parcelId }]
    // failures:  [{ externalId, errors: [...] }]
    const successes = r.data?.successes || [];
    const failures  = r.data?.failures  || [];

    for (const s of successes) {
      const matched = slice.find(v => v.payload.externalId === s.externalId || v.orderId === s.externalId);
      if (matched) {
        toUpdate.push({
          orderId: matched.orderId,
          order:   matched.order,
          tracking: s.parcelId || s.trackingNumber || s.id,
        });
      }
    }

    for (const f of failures) {
      const matched = slice.find(v => v.payload.externalId === f.externalId || v.orderId === f.externalId);
      if (matched) {
        const errMsg = Array.isArray(f.errors)
          ? f.errors.map(e => e.description || e.code || JSON.stringify(e)).join(" | ")
          : extractZRError(f);
        results[matched.orderId] = { error: errMsg };
      }
    }

    // If bulk endpoint returned a top-level error (400)
    if (!r.ok && !successes.length && !failures.length) {
      for (const v of slice) {
        results[v.orderId] = { error: extractZRError(r.data) || `ZR bulk failed (HTTP ${r.status})` };
      }
    }
  }

  // ── 3) Persist shipped status + tracking ─────────────────────────────────
  const changedBy = changedByOf(auth);
  for (const u of toUpdate) {
    try {
      await updateSupabase(u.orderId, {
        status:          "shipped",
        tracking_number: u.tracking,
        shipping_agency: "zr",
      });
      await logHistory(u.order.order_id, "confirmed", "shipped", changedBy);
      results[u.orderId] = { success: true, tracking_number: u.tracking };
    } catch (err) {
      results[u.orderId] = {
        error:          "Shipped on ZR but DB update failed: " + err.message,
        tracking_number: u.tracking,
      };
    }
  }

  const shipped = Object.values(results).filter(r => r.success).length;
  return res.status(200).json({ results, shipped, total: orders.length });
}
