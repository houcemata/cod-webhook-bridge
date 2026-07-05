// api/zr-lookup.js
// Consolidated ZR Express lookup endpoint — replaces zr-territories.js, zr-hubs.js, zr-rates.js
//
// GET /api/zr-lookup?type=territories   → all wilayas + communes with UUIDs
// GET /api/zr-lookup?type=hubs          → all stop desks
// GET /api/zr-lookup?type=rates         → delivery rates per wilaya (preview)
// POST /api/zr-lookup?type=rates        → upsert rates into Supabase shipping_rates

import { getTerritories, zrPost, zrGet } from "./zr.js";

export default async function handler(req, res) {
  const type = req.query?.type || (typeof req.url === 'string' ? new URL(req.url, 'http://x').searchParams.get('type') : null);

  if (!type) return res.status(400).json({ error: "Missing ?type= parameter. Use: territories, hubs, or rates" });

  res.setHeader("Cache-Control", "s-maxage=3600");

  // ── TERRITORIES ────────────────────────────────────────────────────────
  if (type === "territories") {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
    try {
      const items = await getTerritories();
      return res.status(200).json(items);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── HUBS ───────────────────────────────────────────────────────────────
  if (type === "hubs") {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
    if (!process.env.ZR_API_KEY || !process.env.ZR_TENANT_ID)
      return res.status(500).json({ error: "ZR credentials not configured" });
    try {
      const r = await zrPost("/hubs/search", { pageNumber: 1, pageSize: 1000, orderBy: ["name asc"] });
      if (!r.ok) return res.status(r.status).json({ error: "Failed to fetch hubs from ZR Express" });
      return res.status(200).json(r.data?.items || []);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── RATES ──────────────────────────────────────────────────────────────
  if (type === "rates") {
    if (req.method !== "GET" && req.method !== "POST")
      return res.status(405).json({ error: "Method not allowed" });
    if (!process.env.ZR_API_KEY || !process.env.ZR_TENANT_ID)
      return res.status(500).json({ error: "ZR credentials not configured" });
    try {
      const r = await zrGet("/delivery-pricing/rates");
      if (!r.ok) return res.status(r.status).json({ error: "Failed to fetch rates from ZR Express", details: r.data });

      const rates = r.data?.rates || [];
      const rows = [];
      for (const rate of rates) {
        if (!rate.toTerritoryCode || rate.toTerritoryLevel !== "wilaya") continue;
        rows.push({
          wilaya_id:     rate.toTerritoryCode,
          wilaya_name:   rate.toTerritoryName,
          home_delivery: rate.deliveryPrices?.find(p => p.deliveryType === "home")?.price ?? 0,
          stop_desk:     rate.deliveryPrices?.find(p => p.deliveryType === "pickup-point")?.price ?? 0,
        });
      }
      rows.sort((a, b) => a.wilaya_id - b.wilaya_id);

      // GET → preview only
      if (req.method === "GET") return res.status(200).json({ count: rows.length, rates: rows });

      // POST → upsert into Supabase
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) return res.status(500).json({ error: "Supabase credentials not configured" });

      const upsertRes = await fetch(`${url}/rest/v1/shipping_rates`, {
        method: "POST",
        headers: {
          apikey:         key,
          Authorization:  `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer:         "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
      });
      if (!upsertRes.ok) {
        const err = await upsertRes.text();
        return res.status(500).json({ error: "Supabase upsert failed", details: err });
      }
      return res.status(200).json({ success: true, message: `Upserted ${rows.length} wilaya rates from ZR Express`, rates: rows });

    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: `Unknown type "${type}". Use: territories, hubs, or rates` });
}
