// api/shopify-webhook.js
// Shopify → Supabase bridge for COD operations system

import crypto from "crypto";

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function verifyShopifyHmac(rawBody, shopifyHmacHeader, secret) {
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");
  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(shopifyHmacHeader)
  );
}

function parseShopifyOrder(order) {
  const shippingAddress = order.shipping_address || {};
  const lineItems = order.line_items || [];

  const productSummary = lineItems
    .map((item) => {
      const variant = item.variant_title ? ` (${item.variant_title})` : "";
      const qty = item.quantity > 1 ? ` x${item.quantity}` : "";
      return `${item.title}${variant}${qty}`;
    })
    .join(", ");

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
    // FIX: province = wilaya, city = commune in Algerian Shopify orders
    wilaya:  shippingAddress.province || shippingAddress.province_code || "",
    commune: shippingAddress.city || "",
    product: productSummary,
    variable: firstVariant,
type_livraison: (() => {
  const shippingTitle = (order.shipping_lines?.[0]?.title || "").toLowerCase();
  if (shippingTitle.includes("stopdesk") || shippingTitle.includes("stop desk") || shippingTitle.includes("relais")) return "pickup";
  return "home";
})(),
    prix_total: parseFloat(order.total_price || "0"),
    status: "pending",
  };
}

async function insertIntoSupabase(orderData, supabaseUrl, supabaseKey) {
  const response = await fetch(`${supabaseUrl}/rest/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(orderData),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase insert failed: ${response.status} — ${errorText}`);
  }

  return true;
}

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

  if (!response.ok) return false;
  const rows = await response.json();
  return rows.length > 0;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawBody = await getRawBody(req);

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

  let order;
  try {
    order = JSON.parse(rawBody.toString("utf8"));
  } catch (err) {
    console.error("Failed to parse JSON:", err.message);
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase environment variables");
    return res.status(500).json({ error: "Server configuration error" });
  }

  const orderId = String(order.id || "");

  if (!orderId) {
    console.error("Order has no ID — skipping");
    return res.status(400).json({ error: "Order ID missing" });
  }

  const alreadyExists = await orderExists(orderId, supabaseUrl, supabaseKey);
  if (alreadyExists) {
    console.log(`Order ${orderId} already exists — skipping duplicate`);
    return res.status(200).json({ message: "Duplicate — skipped" });
  }

  const orderData = parseShopifyOrder(order);

  try {
    await insertIntoSupabase(orderData, supabaseUrl, supabaseKey);
    console.log(`✓ Order ${orderId} inserted successfully`);
    return res.status(200).json({ message: "Order inserted" });
  } catch (err) {
    console.error("Insert error:", err.message);
    return res.status(500).json({ error: "Insert failed" });
  }
}
