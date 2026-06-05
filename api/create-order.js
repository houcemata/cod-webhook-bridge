import { sendAllAnalytics } from "./_analytics.js";
import { getServiceClient } from "./_auth.js";
import { getCustomCatalogProduct } from "./_catalog.js";

function normalizeVariants(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw)
    ? raw
    : Object.entries(raw).map(([name, value]) =>
        typeof value === "object" ? { name, ...value } : { name, price: value }
      );

  return list.map((variant) => ({
    name: variant.name || variant.label || "Standard",
    label: variant.label || variant.name || "Standard",
    price: Number(variant.price || 0),
    image: variant.image || "",
    options: variant.options && typeof variant.options === "object" ? variant.options : null,
  }));
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\s+/g, "");
}

function normalizeSelectedOptions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const entries = Object.entries(input)
    .map(([key, value]) => [normalizeText(key), normalizeText(value)])
    .filter(([key, value]) => key && value);
  return entries.length ? Object.fromEntries(entries) : null;
}

function sameOptions(a, b) {
  const left = normalizeSelectedOptions(a);
  const right = normalizeSelectedOptions(b);
  if (!left || !right) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

function resolveVariant(product, payload) {
  const variants = normalizeVariants(product.variants);
  if (!variants.length) {
    return {
      name: "Standard",
      label: "Standard",
      price: Number(product.price || 0),
      options: null,
    };
  }

  const selectedOptions = normalizeSelectedOptions(payload.selected_options);
  if (selectedOptions) {
    const match = variants.find((variant) => variant.options && sameOptions(variant.options, selectedOptions));
    if (match) return match;
  }

  const variantLabel = normalizeText(payload.variant_label);
  if (variantLabel) {
    const match = variants.find(
      (variant) => normalizeText(variant.label).toLowerCase() === variantLabel.toLowerCase()
        || normalizeText(variant.name).toLowerCase() === variantLabel.toLowerCase()
    );
    if (match) return match;
  }

  if (variants.length === 1) return variants[0];
  return null;
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

function clientIpFromRequest(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return "";
}

async function sendOrderNotification(orderData) {
  const topic = process.env.NTFY_TOPIC || "arco-new-orders";
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: {
        Title: "New Order",
        Priority: "high",
        Tags: "shopping",
      },
      body: `${orderData.name} - ${orderData.wilaya} - ${orderData.prix_total} DZD`,
    });
  } catch (err) {
    console.error("[create-order] ntfy failed:", err.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabase = getServiceClient();
    const body = req.body || {};

    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: "Forbidden origin" });
    }

    const productSlug = normalizeText(body.product_slug).toLowerCase();
    const name = normalizeText(body.name);
    const phone = normalizePhone(body.phone);
    const wilaya = normalizeText(body.wilaya);
    const commune = normalizeText(body.commune);
    const notes = normalizeText(body.notes);
    const draftOrderId = normalizeText(body.draft_order_id);
    const deliveryType = body.delivery_type === "pickup" ? "pickup" : "home";
    const stationCode = deliveryType === "pickup" ? normalizeText(body.station_code) : null;
    const wilayaId = Number(body.wilaya_id);

    if (!productSlug) return res.status(400).json({ error: "Product is required" });
    if (!name) return res.status(400).json({ error: "Name is required" });
    if (!/^0[567]\d{8}$/.test(phone)) return res.status(400).json({ error: "Invalid phone number" });
    if (!wilaya || !Number.isInteger(wilayaId) || wilayaId < 1) {
      return res.status(400).json({ error: "Wilaya is required" });
    }
    if (deliveryType === "home" && !commune) {
      return res.status(400).json({ error: "Commune is required for home delivery" });
    }
    if (deliveryType === "pickup" && !stationCode) {
      return res.status(400).json({ error: "Station code is required for pickup" });
    }

    const { data: productRow, error: productError } = await supabase
      .from("products")
      .select("name, slug, price, active, variants")
      .eq("slug", productSlug)
      .eq("active", true)
      .limit(1)
      .maybeSingle();

    const product = productRow || getCustomCatalogProduct(productSlug);

    if (productError || !product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const variant = resolveVariant(product, body);
    const fallbackVariantLabel = normalizeText(body.variant_label) || normalizeText(body.selected_options?.MODEL) || normalizeText(body.selected_options?.Model) || "Standard";
    const resolvedVariant = variant || (productSlug === "barber-shop"
      ? {
          name: fallbackVariantLabel,
          label: fallbackVariantLabel,
          price: Number(product.price || 0),
          image: "",
          options: null,
        }
      : null);

    if (!resolvedVariant || !Number.isFinite(resolvedVariant.price) || resolvedVariant.price <= 0) {
      return res.status(400).json({ error: "Invalid variant selection" });
    }

    const { data: shippingRow, error: shippingError } = await supabase
      .from("shipping_rates")
      .select("home_delivery, stop_desk")
      .eq("wilaya_id", wilayaId)
      .limit(1)
      .maybeSingle();

    if (shippingError || !shippingRow) {
      return res.status(400).json({ error: "Shipping is unavailable for this wilaya" });
    }

    const shippingCost = deliveryType === "pickup"
      ? Number(shippingRow.stop_desk || 0)
      : Number(shippingRow.home_delivery || 0);

    if (!Number.isFinite(shippingCost) || shippingCost <= 0) {
      return res.status(400).json({ error: "Shipping price is unavailable" });
    }

    const total = Number(resolvedVariant.price) + shippingCost;
    const orderId = createOrderId();
    const orderData = {
      name,
      phone,
      wilaya,
      commune: deliveryType === "home" ? commune : "",
      type_livraison: deliveryType,
      station_code: stationCode,
      product: product.name,
      variable: resolvedVariant.label || resolvedVariant.name,
      prix_total: total,
      shipping_cost: shippingCost,
      status: "pending",
      notes,
    };
    const finalOrderData = { ...orderData, order_id: orderId };

    let updatedDraft = false;
    const draftCandidates = [];
    if (draftOrderId) {
      draftCandidates.push(
        supabase.from("orders").select("id, order_id").eq("order_id", draftOrderId).eq("status", "draft").maybeSingle()
      );
    }
    draftCandidates.push(
      supabase
        .from("orders")
        .select("id, order_id")
        .eq("phone", phone)
        .eq("product", product.name)
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    for (const candidate of draftCandidates) {
      const { data: draftRow } = await candidate;
      if (!draftRow) continue;
      const { error: updateError } = await supabase
        .from("orders")
        .update({
          name,
          phone,
          wilaya,
          commune: deliveryType === "home" ? commune : "",
          type_livraison: deliveryType,
          station_code: stationCode,
          product: product.name,
          variable: resolvedVariant.label || resolvedVariant.name,
          prix_total: total,
          shipping_cost: shippingCost,
          status: "pending",
          notes,
        })
        .eq("id", draftRow.id);

      if (updateError) {
        console.error("[create-order] draft update failed:", updateError);
        return res.status(500).json({ error: "Failed to save order" });
      }
      updatedDraft = true;
      finalOrderData.order_id = draftRow.order_id;
      break;
    }

    if (!updatedDraft) {
      const { error: insertError } = await supabase
        .from("orders")
        .insert(finalOrderData);

      if (insertError) {
        console.error("[create-order] insert failed:", insertError);
        return res.status(500).json({ error: "Failed to save order" });
      }
    }

    await sendOrderNotification(finalOrderData);
    await sendAllAnalytics({
      event_name: "Purchase",
      order_id: finalOrderData.order_id,
      value: total,
      currency: "DZD",
      product: product.name,
      variant: orderData.variable,
      phone,
      name,
      event_source_url: normalizeText(body.event_source_url) || req.headers.referer || "",
      client_ip_address: clientIpFromRequest(req),
      client_user_agent: req.headers["user-agent"] || "",
    });

    return res.status(200).json({ ok: true, order_id: finalOrderData.order_id, updated_draft: updatedDraft });
  } catch (err) {
    console.error("[create-order]", err);
    return res.status(500).json({ error: err.message || "Order creation failed" });
  }
}
