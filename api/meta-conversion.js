import { sendMetaConversion } from "./_analytics.js";
import { isInternalRequest, requireRole } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isInternalRequest(req)) {
    const auth = await requireRole(req, ["operator", "admin"]);
    if (!auth.ok) {
      return res.status(auth.status).json({ ok: false, provider: "meta", error: auth.error });
    }
  }

  try {
    const result = await sendMetaConversion(req.body || {});
    return res.status(200).json(result);
  } catch (err) {
    console.error("[meta-conversion]", err);
    return res.status(200).json({ ok: false, provider: "meta", error: err.message });
  }
}
