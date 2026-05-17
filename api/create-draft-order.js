import { getServiceClient } from "./_auth.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\s+/g, "");
}

function createOrderId() {
  return `${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
}

function isSameOriginRequest(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function resolveVariant(product, payload) {
  const raw = product.variants;
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object") {
    list = Object.entries(raw).map(([name, value]) =>
      typeof value === "object" ? { name, ...value } : { name, price: value }
    );
  }
  if (!list.length) {
    return { name: "Standard", label: "Standard", price: Number(product.price || 0) };
  }
  const variantLabel = normalizeText(payload.variant_label).toLowerCase();
  if (variantLabel) {
    const match = list.find((variant) => {
      const label = normalizeText(variant.label || variant.name).toLowerCase();
      return label === variantLabel;
    });
    if (match) return match;
  }
  return list[0];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: "Forbidden origin" });
    }

    const supabase = getServiceClient();
    const body = req.body || {};
    const productSlug = normalizeText(body.product_slug).toLowerCase();
    const phone = normalizePhone(body.phone);

    if (!productSlug) return res.status(400).json({ error: "Product is required" });
    if (!/^0[567]\d{8}$/.test(phone)) return res.status(400).json({ error: "Invalid phone number" });

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("name, slug, price, active, variants")
      .eq("slug", productSlug)
      .eq("active", true)
      .limit(1)
      .maybeSingle();

    if (productError || !product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const variant = resolveVariant(product, body);
    const productName = product.name || product.slug;
    const shippingCost = Number(body.shipping_cost || 0);
    const draftData = {
      name: normalizeText(body.name) || "",
      phone,
      wilaya: normalizeText(body.wilaya) || "",
      commune: normalizeText(body.commune) || "",
      type_livraison: body.delivery_type === "pickup" ? "pickup" : "home",
      station_code: body.delivery_type === "pickup" ? normalizeText(body.station_code) || null : null,
      product: productName,
      variable: normalizeText(variant.label || variant.name || "Standard"),
      prix_total: Number(variant.price || product.price || 0) + shippingCost,
      shipping_cost: shippingCost,
      status: "draft",
      notes: normalizeText(body.notes) || "draft lead",
    };
    const orderData = { order_id: createOrderId(), ...draftData };

    const { data: existingDraft } = await supabase
      .from("orders")
      .select("id, order_id")
      .eq("phone", phone)
      .eq("product", productName)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingDraft) {
      const { error: updateError } = await supabase
        .from("orders")
        .update(draftData)
        .eq("id", existingDraft.id);
      if (updateError) {
        console.error("[create-draft-order] update failed:", updateError);
        return res.status(500).json({ error: "Failed to update draft order" });
      }
      return res.status(200).json({ ok: true, draft_order_id: existingDraft.order_id, reused: true });
    }

    const { error: insertError } = await supabase.from("orders").insert(orderData);
    if (insertError) {
      console.error("[create-draft-order] insert failed:", insertError);
      return res.status(500).json({ error: "Failed to save draft order" });
    }

    return res.status(200).json({ ok: true, draft_order_id: orderData.order_id });
  } catch (err) {
    console.error("[create-draft-order]", err);
    return res.status(500).json({ error: err.message || "Draft order creation failed" });
  }
}
