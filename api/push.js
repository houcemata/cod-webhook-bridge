import { getServiceClient, requireRole } from "./_auth.js";
import { getPushPublicKey, sendPushPayload } from "./_push.js";

function cleanText(value, fallback, maxLength = 160) {
  return String(value || fallback || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export default async function handler(req, res) {
  const action = req.query?.action || new URL(req.url, `https://${req.headers.host || "arco-art.store"}`).searchParams.get("action");
  if (action === "config" && req.method === "GET") {
    const publicKey = getPushPublicKey();
    if (!publicKey) return res.status(503).json({ error: "Push notifications are not configured" });
    return res.status(200).json({ publicKey });
  }
  if (action !== "subscribe" && action !== "stock-alert") return res.status(405).json({ error: "Method not allowed" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireRole(req, ["admin", "operator"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  try {
    if (action === "stock-alert") {
      const title = cleanText(req.body?.title, "ARCO Stock Alert", 80);
      const body = cleanText(req.body?.body, "Workshop stock needs attention.", 240);
      const tag = cleanText(req.body?.tag, "arco-stock-alert", 80).replace(/[^a-z0-9:_-]/gi, "-");
      const result = await sendPushPayload({
        title,
        body,
        icon: "/arco-icon.svg",
        badge: "/arco-badge.svg",
        tag,
        url: "/stock.html",
      });
      return res.status(200).json({ ok: true, ...result });
    }

    const subscription = req.body?.subscription;
    const endpoint = subscription?.endpoint;
    if (!endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return res.status(400).json({ error: "Invalid push subscription" });
    const row = { user_id: auth.user.id, endpoint, subscription, user_agent: req.headers["user-agent"] || "", updated_at: new Date().toISOString() };
    const { error } = await getServiceClient().from("push_subscriptions").upsert(row, { onConflict: "endpoint" });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[push] subscription failed:", error);
    return res.status(500).json({ error: error.message || "Subscription failed" });
  }
}
