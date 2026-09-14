import { getServiceClient, requireRole } from "./_auth.js";
import { uploadOperatorCustomImage } from "./_operator-custom-upload.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const auth = await requireRole(req, ["operator", "admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  try {
    const body = req.body || {};
    const orderId = String(body.order_id || "").trim();
    if (!orderId || !body.custom_file) return res.status(400).json({ error: "Order and cropped image are required" });
    const supabase = getServiceClient();
    const { data: order, error } = await supabase.from("orders").select("id,order_id").eq("id", orderId).maybeSingle();
    if (error || !order) return res.status(404).json({ error: "Order not found" });
    const upload = await uploadOperatorCustomImage(body.custom_file, order.order_id || order.id);
    return res.status(200).json({ ok: true, upload });
  } catch (error) {
    console.error("[operator-upload-custom-image]", error);
    return res.status(500).json({ error: error.message || "Upload failed" });
  }
}
