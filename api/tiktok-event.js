import { sendTikTokEvent } from "./_analytics.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const result = await sendTikTokEvent(req.body || {});
    return res.status(200).json(result);
  } catch (err) {
    console.error("[tiktok-event]", err);
    return res.status(200).json({ ok: false, provider: "tiktok", error: err.message });
  }
}
