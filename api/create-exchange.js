import { getServiceClient, requireRole } from "./_auth.js";
import {
  getWilayaId,
  normalizePhone,
  sanitizeNoestText,
  normalizeStationCode,
  resolveCommuneAndWilayaForNoest,
  noestPost,
} from "./_ship-order.js";

function createExchangeOrderId(sourceOrderRef) {
  return `${sourceOrderRef}-EX-${Date.now()}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireRole(req, ["operator", "admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const body = req.body || {};
  const sourceOrderId = Number(body.sourceOrderId);
  const product = sanitizeNoestText(body.product, "");
  const variable = sanitizeNoestText(body.variable, "");
  const amount = Number(body.amount);

  if (!Number.isInteger(sourceOrderId) || sourceOrderId <= 0) return res.status(400).json({ error: "A source order is required" });
  if (!product) return res.status(400).json({ error: "Exchange product is required" });
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: "Exchange amount is invalid" });

  const noestToken = process.env.NOEST_API_KEY;
  const noestGuid = process.env.NOEST_GUID;
  if (!noestToken || !noestGuid) return res.status(500).json({ error: "Noest credentials not configured" });

  const supabase = getServiceClient();
  const { data: source, error: sourceError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", sourceOrderId)
    .maybeSingle();
  if (sourceError) return res.status(500).json({ error: sourceError.message });
  if (!source) return res.status(404).json({ error: "Source order not found" });

  const wilayaId = getWilayaId(source.wilaya);
  if (!wilayaId) return res.status(400).json({ error: `Unknown wilaya: "${source.wilaya}"` });
  const phone = normalizePhone(source.phone);
  if (phone.length < 8) return res.status(400).json({ error: "Source order phone number is invalid" });

  const isStopDesk = source.type_livraison === "pickup";
  const stationCode = normalizeStationCode(source.station_code);
  if (isStopDesk && !stationCode) return res.status(400).json({ error: "The source order has no stop desk code" });

  let commune = "";
  if (!isStopDesk) {
    const location = await resolveCommuneAndWilayaForNoest(wilayaId, source.commune || "", noestToken);
    if (!location.ok) return res.status(400).json({ error: location.error });
    commune = location.commune || "";
  }

  const exchangeOrderId = createExchangeOrderId(source.order_id || source.id);
  const payload = {
    user_guid: noestGuid,
    reference: exchangeOrderId,
    client: sanitizeNoestText(source.name, `Client ${sourceOrderId}`),
    phone,
    adresse: sanitizeNoestText(source.commune || source.wilaya, source.wilaya || "Algerie"),
    wilaya_id: wilayaId,
    ...(commune ? { commune } : {}),
    montant: amount,
    produit: variable ? `${product} - ${variable}` : product,
    remarque: `Exchange for ${source.order_id || source.id}`,
    type_id: 2,
    stop_desk: isStopDesk ? 1 : 0,
    can_open: 1,
    poids: 0.5,
    ...(isStopDesk ? { station_code: stationCode } : {}),
  };

  const createRes = await noestPost("/create/order", payload, noestToken);
  if (!createRes.ok || !createRes.data?.success || !createRes.data?.tracking) {
    return res.status(400).json({ error: createRes.data?.message || "Noest exchange creation failed" });
  }
  const tracking = createRes.data.tracking;

  const validateRes = await noestPost("/valid/order", { user_guid: noestGuid, tracking }, noestToken);
  if (!validateRes.ok || !validateRes.data?.success) {
    return res.status(400).json({ error: "Exchange was created in Noest but could not be validated", tracking_number: tracking });
  }

  const { error: insertError } = await supabase.from("orders").insert({
    order_id: exchangeOrderId,
    name: source.name,
    phone: source.phone,
    wilaya: source.wilaya,
    commune: source.commune || "",
    product,
    variable: variable || "Standard",
    type_livraison: source.type_livraison || "home",
    prix_total: amount,
    shipping_cost: source.shipping_cost || 0,
    status: "shipped",
    tracking_number: tracking,
    shipping_agency: "noest",
    station_code: source.station_code || "",
    notes: `Échange for order #${source.order_id || source.id}`,
  });
  if (insertError) return res.status(500).json({ error: "Exchange shipped, but could not be saved in the operator app", tracking_number: tracking });

  await supabase.from("order_history").insert({
    order_id: exchangeOrderId,
    old_status: "confirmed",
    new_status: "shipped",
    changed_by: auth.role?.name || auth.role?.email || auth.user?.email || "operator",
  });

  return res.status(200).json({ success: true, exchange_order_id: exchangeOrderId, tracking_number: tracking });
}
