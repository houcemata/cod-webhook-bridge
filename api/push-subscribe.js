import { getServiceClient, requireRole } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });
  const auth = await requireRole(req, ["admin", "operator"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const supabase = getServiceClient();

  try {
    const subscription = req.body?.subscription;
    const endpoint = subscription?.endpoint;
    if (!endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: "Invalid push subscription" });
    }
    const row = { user_id: auth.user.id, endpoint, subscription, user_agent: req.headers["user-agent"] || "", updated_at: new Date().toISOString() };
    const { error } = await supabase.from("push_subscriptions").upsert(row, { onConflict: "endpoint" });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[push-subscribe]", error);
    return res.status(500).json({ error: error.message || "Subscription failed" });
  }
}
