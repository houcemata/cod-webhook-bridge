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

function sizeCode(label) {
  const norm = String(label || "")
    .toLowerCase()
    .replace(/سم|cm/g, "")
    .replace(/[×*]/g, "x")
    .replace(/\s+/g, "");
  if (norm.includes("30x40")) return "M";
  if (norm.includes("40x60")) return "L";
  return label || "";
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

// ── Algerian IP check via ipwho.is ──────────────────────────────
// Free, unlimited, no API key.
// Returns { ok: true } if Algerian non-proxy, { ok: false, reason } otherwise.
// Fails OPEN on errors so real customers are never blocked by API downtime.
async function checkIpCountry(ip) {
  if (!ip) return { ok: false, reason: "no_ip" };
  try {
    const res = await fetch(`https://ipwho.is/${ip}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      console.warn(`[create-order] ipwho.is returned ${res.status} for ${ip}, allowing`);
      return { ok: true }; // fail open
    }
    const data = await res.json();
    if (data.is_proxy === true) {
      console.warn(`[create-order] blocked proxy/VPN IP: ${ip} (country: ${data.country_code})`);
      return { ok: false, reason: "proxy" };
    }
    if (data.country_code !== "DZ") {
      console.warn(`[create-order] blocked non-DZ IP: ${ip} (country: ${data.country_code})`);
      return { ok: false, reason: "non_dz" };
    }
    return { ok: true };
  } catch (err) {
    console.warn(`[create-order] ipwho.is lookup failed (allowing): ${err.message}`);
    return { ok: true }; // fail open
  }
}

// ── Daily per-IP order limit ─────────────────────────────────────
// Each IP may place at most this many real (non-draft) orders per
// calendar day (Algeria time, UTC+1, no DST). Resets at midnight.
const DAILY_IP_ORDER_LIMIT = 2;
const IP_LIMIT_MESSAGE =
  "لقد وصلت إلى الحد الأقصى للطلبات اليوم (طلبان). جرّب غداً أو تواصل معنا عبر واتساب.";
const IP_BLOCKED_MESSAGE =
  "عذراً، لا يمكن إتمام الطلب. تواصل معنا عبر واتساب إذا كنت تواجه مشكلة.";

function startOfTodayAlgiersUtc() {
  const offsetMs = 60 * 60 * 1000; // Algeria = UTC+1, no daylight saving
  const algiers = new Date(Date.now() + offsetMs);
  const midnightAlgiers = Date.UTC(
    algiers.getUTCFullYear(),
    algiers.getUTCMonth(),
    algiers.getUTCDate()
  );
  return new Date(midnightAlgiers - offsetMs).toISOString();
}

// Returns how many non-draft orders this IP already placed today.
async function ipOrderCountToday(supabase, ip) {
  try {
    const { count, error } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ip)
      .neq("status", "draft")
      .gte("created_at", startOfTodayAlgiersUtc());
    if (error) {
      console.error("[create-order] ip rate-limit query failed (allowing):", error.message || error);
      return 0;
    }
    return count || 0;
  } catch (err) {
    console.error("[create-order] ip rate-limit threw (allowing):", err.message);
    return 0;
  }
}

// ── Unified IP gate ──────────────────────────────────────────────
// Call this before inserting any order. Returns null if OK,
// or a Response (via res) that should be returned immediately.
async function checkIpGate(req, res, supabase) {
  const ip = clientIpFromRequest(req);

  // 1. Block missing IP (null-IP bypass attack)
  if (!ip) {
    console.warn("[create-order] blocked: no IP detected");
    return res.status(403).json({ error: IP_BLOCKED_MESSAGE });
  }

  // 2. Block non-Algerian IPs and proxies/VPNs
  const { ok, reason } = await checkIpCountry(ip);
  if (!ok) {
    console.warn(`[create-order] blocked IP: ${ip} reason: ${reason}`);
    return res.status(403).json({ error: IP_BLOCKED_MESSAGE });
  }

  // 3. Daily rate limit
  if (await ipOrderCountToday(supabase, ip) >= DAILY_IP_ORDER_LIMIT) {
    return res.status(429).json({ error: IP_LIMIT_MESSAGE });
  }

  return null; // all checks passed
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

// ════════════════════════════════════════════════════════════════
// CART ORDER HANDLER (multi-item, buy-2-get-1-free)
// ════════════════════════════════════════════════════════════════
async function handleCartOrder(req, res, supabase, body) {
  const name = normalizeText(body.name);
  const phone = normalizePhone(body.phone);
  const wilaya = normalizeText(body.wilaya);
  const commune = normalizeText(body.commune);
  const notes = normalizeText(body.notes);
  const deliveryType = body.delivery_type === "pickup" ? "pickup" : "home";
  const stationCode = deliveryType === "pickup" ? normalizeText(body.station_code) : null;
  const wilayaId = Number(body.wilaya_id);
  const items = Array.isArray(body.items) ? body.items : [];
  const clientIp = clientIpFromRequest(req);

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
  if (!items.length) return res.status(400).json({ error: "Cart is empty" });

  // ── IP gate (null + non-DZ + rate limit) ──
  const blocked = await checkIpGate(req, res, supabase);
  if (blocked) return blocked;

  // Resolve each cart item against the DB (never trust browser prices)
  const resolved = [];
  for (const it of items) {
    const slug = normalizeText(it.product_slug);
    if (!slug) continue;
    const { data: productRow } = await supabase
      .from("products")
      .select("name, slug, price, active, variants, type")
      .ilike("slug", slug)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    const product = productRow || getCustomCatalogProduct(slug);
    if (!product) return res.status(404).json({ error: `Product not found: ${slug}` });

    const variant = resolveVariant(product, it);
    if (!variant || !Number.isFinite(variant.price) || variant.price <= 0) {
      return res.status(400).json({ error: `Invalid variant for ${product.name}` });
    }
    resolved.push({
      product_slug: product.slug,
      product: product.name,
      variant: variant.label || variant.name,
      options: variant.options || null,
      price: Number(variant.price),
    });
  }

  if (!resolved.length) return res.status(400).json({ error: "No valid items" });

  // every-3rd-free: the CHEAPEST in each group of 3 becomes free
  const sortedAsc = [...resolved].sort((a, b) => a.price - b.price);
  const freeCount = Math.floor(resolved.length / 3);
  const freeSet = new Set();
  for (let i = 0; i < freeCount; i++) freeSet.add(sortedAsc[i]);
  let itemsTotal = 0;
  const itemsForStore = resolved.map((it) => {
    const isFree = freeSet.has(it);
    const linePrice = isFree ? 0 : it.price;
    itemsTotal += linePrice;
    return { ...it, size: sizeCode(it.variant), is_free: isFree, line_price: linePrice };
  });

  const { data: shippingRow } = await supabase
    .from("shipping_rates")
    .select("home_delivery, stop_desk")
    .eq("wilaya_id", wilayaId)
    .limit(1)
    .maybeSingle();
  if (!shippingRow) return res.status(400).json({ error: "Shipping is unavailable for this wilaya" });
  const shippingCost = deliveryType === "pickup"
    ? Number(shippingRow.stop_desk || 0)
    : Number(shippingRow.home_delivery || 0);
  if (!Number.isFinite(shippingCost) || shippingCost <= 0) {
    return res.status(400).json({ error: "Shipping price is unavailable" });
  }

  const total = itemsTotal + shippingCost;
  const orderId = createOrderId();

  const composedNotes = notes || "";
  const productSummary = `سلة ${itemsForStore.length} قطع`;
  const variableSummary = itemsForStore.map((it) => it.variant).join(" + ").slice(0, 250);

  const finalOrderData = {
    name,
    phone,
    wilaya,
    commune: deliveryType === "home" ? commune : "",
    type_livraison: deliveryType,
    station_code: stationCode,
    product: productSummary,
    variable: variableSummary,
    prix_total: total,
    shipping_cost: shippingCost,
    status: "pending",
    notes: composedNotes,
    items: itemsForStore,
    order_id: orderId,
    ip_address: clientIp || null,
  };

  const { error: insertError } = await supabase.from("orders").insert(finalOrderData);
  if (insertError) {
    console.error("[create-order] cart insert failed:", insertError);
    return res.status(500).json({ error: "Failed to save order" });
  }

  await sendOrderNotification(finalOrderData);
  await sendAllAnalytics({
    event_name: "Purchase",
    order_id: orderId,
    value: total,
    currency: "DZD",
    product: productSummary,
    variant: variableSummary,
    phone,
    name,
    event_source_url: normalizeText(body.event_source_url) || req.headers.referer || "",
    client_ip_address: clientIpFromRequest(req),
    client_user_agent: req.headers["user-agent"] || "",
  });

  return res.status(200).json({ ok: true, order_id: orderId, cart: true, free_count: freeCount });
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

    // NEW: cart checkout path (multi-item). Single-product logic below is untouched.
    if (Array.isArray(body.items) && body.items.length) {
      return await handleCartOrder(req, res, supabase, body);
    }

    const productSlug = normalizeText(body.product_slug);
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
      .ilike("slug", productSlug)
      .eq("active", true)
      .limit(1)
      .maybeSingle();

    const product = productRow || getCustomCatalogProduct(productSlug);

    if (productError || !product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const variant = resolveVariant(product, body);
    const fallbackVariantLabel = normalizeText(body.variant_label) || normalizeText(body.selected_options?.MODEL) || normalizeText(body.selected_options?.Model) || "Standard";
    const resolvedVariant = variant || (productSlug.toLowerCase() === "barber-shop"
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
    const clientIp = clientIpFromRequest(req);

    // ── IP gate (null + non-DZ + rate limit) ──
    const blocked = await checkIpGate(req, res, supabase);
    if (blocked) return blocked;

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
      ip_address: clientIp || null,
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
          from_draft: true,
          notes,
          ip_address: clientIp || null,
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
