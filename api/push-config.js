import { getPushPublicKey } from "./_push.js";

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const publicKey = getPushPublicKey();
  if (!publicKey) return res.status(503).json({ error: "Push notifications are not configured" });
  return res.status(200).json({ publicKey });
}
