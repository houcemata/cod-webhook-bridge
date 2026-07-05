// api/zr-territories.js
// Returns all ZR Express territories (wilayas + communes) with their UUIDs.
// Used by the operator panel to build the stop-desk / hub picker.
// Cached for 1 hour via Cache-Control.

import { getTerritories } from "./zr.js";

export default async function handler(req, res) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const items = await getTerritories();
    res.setHeader("Cache-Control", "s-maxage=3600");
    return res.status(200).json(items);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
