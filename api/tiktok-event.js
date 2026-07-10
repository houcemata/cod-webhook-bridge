import { sendTikTokEvent } from "./_analytics.js";
import { isInternalRequest, requireRole } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isInternalRequest(req)) {
    const auth = await requireRole(req, ["operator", "admin"]);
    if (!auth.ok) {
      return res.status(auth.status).json({ ok: false, provider: "tiktok", error: auth.error });
    }
  }

  try {
    const result = await sendTikTokEvent(req.body || {});
    return res.status(200).json(result);
  } catch (err) {
    console.error("[tiktok-event]", err);
    return res.status(200).json({ ok: false, provider: "tiktok", error: err.message });
  }
}
