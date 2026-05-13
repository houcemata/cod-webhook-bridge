import { sendMetaConversion } from "./_analytics.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const result = await sendMetaConversion(req.body || {});
    return res.status(200).json(result);
  } catch (err) {
    console.error("[meta-conversion]", err);
    return res.status(200).json({ ok: false, provider: "meta", error: err.message });
  }
}
