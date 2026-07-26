import webpush from "web-push";
import { getServiceClient } from "./_auth.js";

let configured = false;

function configure() {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:ops@arco-art.store";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function getPushPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || "";
}

export async function sendNewOrderPush(order) {
  if (!configure()) {
    console.warn("[push] VAPID keys are not configured; skipping web push");
    return { sent: 0, skipped: true };
  }

  const supabase = getServiceClient();
  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("id, subscription");
  if (error) {
    console.error("[push] subscription query failed:", error.message || error);
    return { sent: 0, skipped: true };
  }

  const payload = JSON.stringify({
    title: "ARCO — New order",
    body: `#${order.order_id} · ${order.name || "Customer"} · ${order.prix_total || 0} DZD`,
    icon: "/arco-icon.svg",
    badge: "/arco-badge.svg",
    tag: `arco-order-${order.order_id}`,
    url: `/operator.html?order=${encodeURIComponent(order.order_id)}`,
  });
  const results = await Promise.all((subscriptions || []).map(async (row) => {
    try {
      await webpush.sendNotification(row.subscription, payload, { TTL: 86400 });
      return true;
    } catch (pushError) {
      const status = pushError?.statusCode;
      if (status === 404 || status === 410) await supabase.from("push_subscriptions").delete().eq("id", row.id);
      else console.error("[push] delivery failed:", pushError.message || pushError);
      return false;
    }
  }));
  return { sent: results.filter(Boolean).length, skipped: false };
}
