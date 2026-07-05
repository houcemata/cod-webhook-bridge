// api/zr-rates.js
// Fetches ZR Express delivery rates for all wilayas and returns them
// in the format needed to upsert into the Supabase shipping_rates table.
//
// GET  /api/zr-rates          → returns rates JSON (for operator to review)
// POST /api/zr-rates          → fetches rates and upserts into Supabase shipping_rates table

import { zrGet } from "./zr.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ZR_API_KEY || !process.env.ZR_TENANT_ID)
    return res.status(500).json({ error: "ZR Express credentials not configured" });

  try {
    // Fetch all rates from ZR
    const r = await zrGet("/delivery-pricing/rates");
    if (!r.ok)
      return res.status(r.status).json({ error: "Failed to fetch rates from ZR Express", details: r.data });

    const rates = r.data?.rates || [];

    // Build rows for shipping_rates table
    // ZR rates are per territory (wilaya level), each with deliveryPrices array
    // We only care about wilaya-level entries (code 1-58)
    const rows = [];
    for (const rate of rates) {
      if (!rate.toTerritoryCode || rate.toTerritoryLevel !== "wilaya") continue;

      const homePrice   = rate.deliveryPrices?.find(p => p.deliveryType === "home")?.price ?? 0;
      const pickupPrice = rate.deliveryPrices?.find(p => p.deliveryType === "pickup-point")?.price ?? 0;

      rows.push({
        wilaya_id:     rate.toTerritoryCode,    // integer 1-58
        wilaya_name:   rate.toTerritoryName,
        home_delivery: homePrice,
        stop_desk:     pickupPrice,
      });
    }

    rows.sort((a, b) => a.wilaya_id - b.wilaya_id);

    // GET → just return the rates for review
    if (req.method === "GET") {
      return res.status(200).json({ count: rows.length, rates: rows });
    }

    // POST → upsert into Supabase shipping_rates
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
      return res.status(500).json({ error: "Supabase credentials not configured" });

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

    return res.status(200).json({
      success: true,
      message: `Upserted ${rows.length} wilaya shipping rates from ZR Express`,
      rates:   rows,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
