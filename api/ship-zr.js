// api/ship-zr.js
// Consolidated ZR Express shipping endpoint — replaces ship-order-zr.js and ship-orders-bulk-zr.js
//
// POST with { orderId, order, hubId }         → single order
// POST with { orders: [...] }                 → bulk (up to 100)

import { requireRole } from "./_auth.js";
import {
  zrPost, findWilayaId, findCommuneId,
  buildZRPayload, updateSupabase, logHistory,
} from "./_zr.js";

function changedByOf(auth) {
  return auth.role?.name || auth.role?.email || auth.user?.email || auth.role?.role || "operator";
}

function extractZRError(data) {
  if (!data) return "ZR Express request failed";
  // Field-level errors first — most specific
  if (Array.isArray(data.errors) && data.errors.length)
    return data.errors.map(e => e.description || e.code || JSON.stringify(e)).join(" | ");
  if (data.detail && data.detail !== "One or more validation errors occurred") return String(data.detail);
  if (data.title)  return String(data.title);
  if (data.detail) return String(data.detail);
  return JSON.stringify(data);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireRole(req, ["operator", "admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  if (!process.env.ZR_API_KEY || !process.env.ZR_TENANT_ID)
    return res.status(500).json({ error: "ZR Express credentials not configured" });

  const body = req.body || {};

  // ── BULK: body has { orders: [...] } ──────────────────────────────────
  if (Array.isArray(body.orders)) {
    const { orders } = body;
    if (!orders.length) return res.status(400).json({ error: "No orders provided" });

    const results = {};
    const valid   = [];

    for (const item of orders) {
      const { orderId, order, hubId } = item || {};
      if (!orderId || !order) { if (orderId) results[orderId] = { error: "Missing order data" }; continue; }

      const isPickup = order.type_livraison === "pickup";
      let wilayaId = null, communeId = null;

      if (!isPickup) {
        wilayaId = await findWilayaId(order.wilaya);
        if (!wilayaId) { results[orderId] = { error: `Unknown wilaya: "${order.wilaya}"` }; continue; }
        if (order.commune) communeId = await findCommuneId(wilayaId, order.commune);
      }

      valid.push({
        orderId,
        order,
        payload: buildZRPayload({ order, orderId, wilayaId, communeId, hubId: hubId || order.station_code || null }),
      });
    }

    if (!valid.length) return res.status(400).json({ results, shipped: 0, total: orders.length });

    const CHUNK = 100;
    const toUpdate = [];

    for (let i = 0; i < valid.length; i += CHUNK) {
      const slice = valid.slice(i, i + CHUNK);
      const r = await zrPost("/parcels/bulk", { parcels: slice.map(v => v.payload) });

      for (const s of (r.data?.successes || [])) {
        const matched = slice.find(v => v.payload.externalId === s.externalId || v.orderId === s.externalId);
        if (matched) toUpdate.push({ orderId: matched.orderId, order: matched.order, tracking: s.parcelId || s.trackingNumber || s.id });
      }
      for (const f of (r.data?.failures || [])) {
        const matched = slice.find(v => v.payload.externalId === f.externalId || v.orderId === f.externalId);
        if (matched) results[matched.orderId] = { error: Array.isArray(f.errors) ? f.errors.map(e => e.description || e.code).join(" | ") : extractZRError(f) };
      }
      if (!r.ok && !r.data?.successes?.length && !r.data?.failures?.length) {
        console.error("ZR bulk error:", JSON.stringify({ status: r.status, response: r.data, payloads: slice.map(v => v.payload) }, null, 2));
        for (const v of slice) results[v.orderId] = { error: extractZRError(r.data) || `ZR bulk failed (HTTP ${r.status})` };
      }
    }

    const changedBy = changedByOf(auth);
    for (const u of toUpdate) {
      try {
        await updateSupabase(u.orderId, { status: "shipped", tracking_number: u.tracking, shipping_agency: "zr" });
        await logHistory(u.order.order_id, "confirmed", "shipped", changedBy);
        results[u.orderId] = { success: true, tracking_number: u.tracking };
      } catch (err) {
        results[u.orderId] = { error: "Shipped on ZR but DB update failed: " + err.message, tracking_number: u.tracking };
      }
    }

    const shipped = Object.values(results).filter(r => r.success).length;
    return res.status(200).json({ results, shipped, total: orders.length });
  }

  // ── SINGLE: body has { orderId, order, hubId } ────────────────────────
  const { orderId, order, hubId } = body;
  if (!orderId || !order) return res.status(400).json({ error: "Missing orderId or order data" });

  const isPickup = order.type_livraison === "pickup";
  let wilayaId = null, communeId = null;

  if (!isPickup) {
    wilayaId = await findWilayaId(order.wilaya);
    if (!wilayaId)
      return res.status(400).json({ error: `Unknown wilaya: "${order.wilaya}". Edit the order and fix the wilaya first.` });
    if (order.commune) communeId = await findCommuneId(wilayaId, order.commune);
  }

  if (isPickup && !hubId && !order.station_code)
    return res.status(400).json({ error: "Stop desk (hubId) required for pickup orders." });

  const payload = buildZRPayload({ order, orderId, wilayaId, communeId, hubId: hubId || order.station_code || null });
  const r = await zrPost("/parcels", payload);

  if (!r.ok || !r.data?.id) {
    console.error("ZR create error:", JSON.stringify({ status: r.status, orderId, payload, response: r.data }, null, 2));
    return res.status(400).json({ error: extractZRError(r.data), zr_status: r.status, zr_response: r.data });
  }

  const trackingNumber = r.data.id;
  await updateSupabase(orderId, { status: "shipped", tracking_number: trackingNumber, shipping_agency: "zr" });
  await logHistory(order.order_id, "confirmed", "shipped", changedByOf(auth));

  return res.status(200).json({ success: true, tracking_number: trackingNumber });
}
