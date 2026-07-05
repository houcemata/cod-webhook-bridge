// api/zr-hubs.js
// Returns all ZR Express hubs (pickup points / stop desks).
// Replaces noest-desks.js for the operator panel stop-desk picker.
// Cached for 1 hour.

import { zrPost } from "./zr.js";

export default async function handler(req, res) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ZR_API_KEY || !process.env.ZR_TENANT_ID)
    return res.status(500).json({ error: "ZR Express credentials not configured" });

  try {
    // Fetch all hubs in one page
    const r = await zrPost("/hubs/search", {
      pageNumber: 1,
      pageSize:   1000,
      orderBy:    ["name asc"],
    });

    if (!r.ok)
      return res.status(r.status).json({ error: "Failed to fetch hubs from ZR Express" });

    const hubs = r.data?.items || [];
    res.setHeader("Cache-Control", "s-maxage=3600");
    return res.status(200).json(hubs);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
