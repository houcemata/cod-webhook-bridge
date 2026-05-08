// api/shopify-webhook.js
// Shopify → Supabase bridge for COD operations system
// Deploy this file to Vercel inside an /api folder

import crypto from "crypto";

// ─── helpers ───────────────────────────────────────────────────────────────

/**
 * Read the raw request body as a Buffer (needed for HMAC verification).
 * Vercel does not expose rawBody by default, so we collect chunks manually.
 */
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Verify that the webhook truly came from Shopify.
 * Shopify signs every webhook with HMAC-SHA256 using your webhook secret.
 */
function verifyShopifyHmac(rawBody, shopifyHmacHeader, secret) {
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");
  // Use timingSafeEqual to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(shopifyHmacHeader)
  );
}

/**
 * Extract the fields we care about from a raw Shopify order payload.
 * Shopify's JSON structure can be deeply nested — this function handles
 * missing fields gracefully so the handler never crashes on odd orders.
 */
function parseShopifyOrder(order) {
  const shippingAddress = order.shipping_address || {};
  const lineItems = order.line_items || [];

  // Build a readable product string from all line items
  // e.g. "T-Shirt (Red / L) x2, Cap x1"
  const productSummary = lineItems
    .map((item) => {
      const variant = item.variant_title ? ` (${item.variant_title})` : "";
      const qty = item.quantity > 1 ? ` x${item.quantity}` : "";
      return `${item.title}${variant}${qty}`;
    })
    .join(", ");

  // First variant of first line item (for the `variable` field)
  const firstVariant =
    lineItems.length > 0 ? lineItems[0].variant_title || "" : "";

  return {
    order_id: String(order.id || ""),
    name: order.shipping_address
      ? `${shippingAddress.first_name || ""} ${shippingAddress.last_name || ""}`.trim()
      : `${order.billing_address?.first_name || ""} ${order.billing_address?.last_name || ""}`.trim(),
    phone:
      shippingAddress.phone ||
      order.billing_address?.phone ||
      order.phone ||
      "",
    wilaya: shippingAddress.city || shippingAddress.province || "",
    commune: shippingAddress.address1 || "",
    product: productSummary,
    variable: firstVariant,
    type_livraison: "home", // default — can be updated manually in CRM
    prix_total: parseFloat(order.total_price || "0"),
    status: "pending", // always starts as pending
  };
}

/**
 * Insert an order into Supabase using the REST API directly.
 * We use fetch + the Supabase REST API so we don't need to install
 * any npm packages — zero dependencies, works out of the box on Vercel.
 */
async function insertIntoSupabase(orderData, supabaseUrl, supabaseKey) {
  const response = await fetch(`${supabaseUrl}/rest/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: "return=minimal", // don't return the full row (saves bandwidth)
    },
    body: JSON.stringify(orderData),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase insert failed: ${response.status} — ${errorText}`);
  }

  return true;
}

/**
 * Check if an order with this order_id already exists in Supabase.
 * This prevents duplicate rows if Shopify sends the webhook more than once.
 */
async function orderExists(orderId, supabaseUrl, supabaseKey) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=id&limit=1`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    }
  );

  if (!response.ok) return false; // on error, allow insert (fail open)

  const rows = await response.json();
  return rows.length > 0;
}

// ─── main handler ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Read raw body FIRST (before any JSON parsing)
  const rawBody = await getRawBody(req);

  // ── Security: verify the request is from Shopify ──
  const shopifySecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const hmacHeader = req.headers["x-shopify-hmac-sha256"];

  if (!shopifySecret || !hmacHeader) {
    console.error("Missing webhook secret or HMAC header");
    return res.status(401).json({ error: "Unauthorized" });
  }

  let isValid = false;
  try {
    isValid = verifyShopifyHmac(rawBody, hmacHeader, shopifySecret);
  } catch (err) {
    console.error("HMAC verification error:", err.message);
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!isValid) {
    console.error("Invalid Shopify HMAC signature");
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ── Parse the JSON body ──
  let order;
  try {
    order = JSON.parse(rawBody.toString("utf8"));
  } catch (err) {
    console.error("Failed to parse JSON:", err.message);
    return res.status(400).json({ error: "Invalid JSON" });
  }

  // ── Get Supabase credentials from environment ──
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase environment variables");
    return res.status(500).json({ error: "Server configuration error" });
  }

  // ── Deduplication: skip if order already exists ──
  const orderId = String(order.id || "");

  if (!orderId) {
    console.error("Order has no ID — skipping");
    return res.status(400).json({ error: "Order ID missing" });
  }

  const alreadyExists = await orderExists(orderId, supabaseUrl, supabaseKey);
  if (alreadyExists) {
    console.log(`Order ${orderId} already exists — skipping duplicate`);
    // Return 200 so Shopify doesn't retry — this is intentional
    return res.status(200).json({ message: "Duplicate — skipped" });
  }

  // ── Parse and insert ──
  const orderData = parseShopifyOrder(order);

  try {
    await insertIntoSupabase(orderData, supabaseUrl, supabaseKey);
    console.log(`✓ Order ${orderId} inserted successfully`);
    return res.status(200).json({ message: "Order inserted" });
  } catch (err) {
    console.error("Insert error:", err.message);
    // Return 500 so Shopify will retry — it retries up to 19 times
    return res.status(500).json({ error: "Insert failed" });
  }
}
