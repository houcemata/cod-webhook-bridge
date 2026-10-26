import { getServiceClient, requireRole } from "./_auth.js";
import { sanitizeNoestText } from "./_ship-order.js";

function createExchangeOrderId(sourceOrderRef) {
  return `${sourceOrderRef}-EX-${Date.now()}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireRole(req, ["operator", "admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const body = req.body || {};
  const sourceOrderId = Number(body.sourceOrderId);
  const submittedItems = Array.isArray(body.items) ? body.items : [];
  const items = submittedItems
    .map((item) => ({
      product: sanitizeNoestText(item?.product, ""),
      product_slug: sanitizeNoestText(item?.product_slug, ""),
      variant: sanitizeNoestText(item?.variant, "Standard"),
      price: Number(item?.price || 0),
    }))
    .filter((item) => item.product);
  const product = sanitizeNoestText(body.product || items[0]?.product, "");
  const variable = sanitizeNoestText(body.variable || items[0]?.variant, "");
  const amount = Number(body.amount);

  if (!Number.isInteger(sourceOrderId) || sourceOrderId <= 0) return res.status(400).json({ error: "A source order is required" });
  if (!product && !items.length) return res.status(400).json({ error: "At least one exchange product is required" });
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: "Exchange amount is invalid" });

  const supabase = getServiceClient();
  const { data: source, error: sourceError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", sourceOrderId)
    .maybeSingle();
  if (sourceError) return res.status(500).json({ error: sourceError.message });
  if (!source) return res.status(404).json({ error: "Source order not found" });

  const exchangeOrderId = createExchangeOrderId(source.order_id || source.id);
  const storedItems = items.length ? items : [{ product, product_slug: "", variant: variable || "Standard", price: amount }];
  const productSummary = storedItems.length > 1 ? `Échange ${storedItems.length} items` : storedItems[0].product;
  const variableSummary = storedItems.map((item) => item.variant).filter(Boolean).join(" + ").slice(0, 250);

  const { error: insertError } = await supabase.from("orders").insert({
    order_id: exchangeOrderId,
    name: source.name,
    phone: source.phone,
    wilaya: source.wilaya,
    commune: source.commune || "",
    product: productSummary,
    variable: variableSummary || "Standard",
    type_livraison: source.type_livraison || "home",
    prix_total: amount,
    shipping_cost: source.shipping_cost || 0,
    status: "confirmed",
    items: storedItems.map((item) => ({ ...item, size: item.variant, line_price: Number(item.price || 0), is_exchange: true })),
    station_code: source.station_code || "",
    notes: `Échange for order #${source.order_id || source.id}`,
  });
  if (insertError) return res.status(500).json({ error: "Exchange order could not be saved" });

  await supabase.from("order_history").insert({
    order_id: exchangeOrderId,
    old_status: "",
    new_status: "confirmed",
    changed_by: auth.role?.name || auth.role?.email || auth.user?.email || "operator",
  });

  return res.status(200).json({ success: true, exchange_order_id: exchangeOrderId, status: "confirmed" });
}
