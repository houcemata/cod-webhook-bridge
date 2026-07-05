// api/zr.js
// Shared ZR Express helpers — used by ship-order-zr.js, ship-orders-bulk-zr.js,
// zr-territories.js, zr-hubs.js, zr-rates.js, zr-webhook.js

export const ZR_BASE    = "https://api.zrexpress.app/api/v1";
export const ZR_API_KEY = process.env.ZR_API_KEY;
export const ZR_TENANT  = process.env.ZR_TENANT_ID;

export function zrHeaders() {
  return {
    "Content-Type":  "application/json",
    "Accept":        "application/json",
    "X-Api-Key":     ZR_API_KEY,
    "X-Tenant":      ZR_TENANT,
  };
}

export async function zrGet(path) {
  const r = await fetch(`${ZR_BASE}${path}`, { headers: zrHeaders() });
  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}

export async function zrPost(path, body) {
  const r = await fetch(`${ZR_BASE}${path}`, {
    method:  "POST",
    headers: zrHeaders(),
    body:    JSON.stringify(body),
  });
  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}

// ── Territory cache (in-process, refreshed on cold start) ──────────────────
// Maps normalised name → { id, code, level, parentId }
let _territoriesCache = null;

export async function getTerritories() {
  if (_territoriesCache) return _territoriesCache;

  // Fetch all territories in one big page (Algeria has ~58 wilayas + ~1500 communes)
  const r = await zrPost("/territories/search", {
    pageNumber: 1,
    pageSize:   5000,
    orderBy:    ["code asc"],
  });
  if (!r.ok) throw new Error(`ZR territories fetch failed: ${r.status}`);

  const items = r.data?.items || [];
  _territoriesCache = items;
  return items;
}

// Normalise a string for fuzzy matching (strip diacritics, lowercase, collapse spaces)
export function normStr(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['''\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function findWilayaId(wilayaName) {
  const territories = await getTerritories();
  const wilayas = territories.filter(t => t.level === "wilaya");
  const query = normStr(wilayaName);

  // 1) exact normalised match
  let match = wilayas.find(w => normStr(w.name) === query);
  // 2) code-prefix match (e.g. "16" → Alger)
  if (!match) {
    const code = parseInt(wilayaName);
    if (!isNaN(code)) match = wilayas.find(w => w.code === code);
  }
  // 3) contains match
  if (!match) match = wilayas.find(w => normStr(w.name).includes(query) || query.includes(normStr(w.name)));

  return match?.id || null;
}

export async function findCommuneId(wilayaId, communeName) {
  const territories = await getTerritories();
  const communes = territories.filter(t => t.level === "commune" && t.parentId === wilayaId);
  const query = normStr(communeName);

  let match = communes.find(c => normStr(c.name) === query);
  if (!match) match = communes.find(c => normStr(c.name).includes(query) || query.includes(normStr(c.name)));

  return match?.id || null;
}

// ── Supabase helpers ───────────────────────────────────────────────────────
export async function updateSupabase(orderId, fields) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  await fetch(`${url}/rest/v1/orders?id=eq.${orderId}`, {
    method:  "PATCH",
    headers: {
      apikey:         key,
      Authorization:  `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer:         "return=minimal",
    },
    body: JSON.stringify(fields),
  });
}

export async function logHistory(orderRef, oldStatus, newStatus, changedBy) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  await fetch(`${url}/rest/v1/order_history`, {
    method:  "POST",
    headers: {
      apikey:         key,
      Authorization:  `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer:         "return=minimal",
    },
    body: JSON.stringify({
      order_id:   orderRef,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy || "operator",
    }),
  });
}

// ── Phone normalisation ────────────────────────────────────────────────────
// ZR requires international format: +213XXXXXXXXX
export function normalizePhoneZR(phone) {
  let p = String(phone || "").replace(/\D/g, "");
  if (p.startsWith("213")) p = p.slice(3);
  if (p.startsWith("0"))   p = p.slice(1);
  return `+213${p}`;
}

// ── Build ZR parcel payload ────────────────────────────────────────────────
export function buildZRPayload({ order, orderId, wilayaId, communeId, hubId }) {
  const phone = normalizePhoneZR(order.phone);
  const isPickup = order.type_livraison === "pickup";

  // Products — ZR needs at least one; use stockType "none" (no warehouse needed)
  const products = buildProductList(order);

  const payload = {
    customer: {
      customerId: crypto.randomUUID(), // random GUID — not linking to ZR customer
      name:       String(order.name || `Client ${orderId}`).slice(0, 100),
      phone: {
        number1: phone,
      },
    },
    orderedProducts: products,
    deliveryType: isPickup ? "pickup-point" : "home",
    description:  buildDescription(order),
    amount:       parseFloat(order.prix_total || 0),
    externalId:   String(orderId).slice(0, 100),  // DB id — always unique, safe to retry
  };

  if (!isPickup && wilayaId) {
    payload.deliveryAddress = {
      cityTerritoryId:     wilayaId,
      ...(communeId ? { districtTerritoryId: communeId } : {}),
      street: String(order.commune || order.wilaya || "").slice(0, 200),
    };
  }

  if (isPickup && hubId) {
    payload.hubId = hubId;
  }

  return payload;
}

function buildProductList(order) {
  if (Array.isArray(order.items) && order.items.length) {
    return order.items.map(it => {
      const name = it.product || it.product_slug || it.slug || "Poster";
      const size = it.size || it.variant || "";
      const productName = [name, size].filter(Boolean).join(" - ");
      return {
        productName: productName.slice(0, 100),
        unitPrice:   parseFloat(it.line_price || it.price || 0),
        quantity:    1,
        stockType:   "none",
      };
    });
  }
  // Single-product order: include variant if present
  const name = order.product || "Poster";
  const variant = order.variable || "";
  const productName = [name, variant].filter(Boolean).join(" - ");
  return [{
    productName: productName.slice(0, 100),
    unitPrice:   parseFloat((order.prix_total || 0) - (order.shipping_cost || 0)),
    quantity:    1,
    stockType:   "none",
  }];
}

function buildDescription(order) {
  if (Array.isArray(order.items) && order.items.length) {
    const parts = order.items.map(it => {
      const name = it.product || it.product_slug || it.slug || "";
      const size = it.size || it.variant || "";
      return [name, size].filter(Boolean).join(" ");
    }).filter(Boolean);
    return parts.join(", ").slice(0, 250) || "Commande ARCO";
  }
  // Single-product: include variant
  const base = order.product || "Commande ARCO";
  const variant = order.variable || "";
  return [base, variant].filter(Boolean).join(" - ").slice(0, 250);
}

// ── Map ZR state names → ARCO statuses ────────────────────────────────────
export const ZR_STATE_MAP = {
  // In transit / processing
  "order received":          "shipped",
  "ready to dispatch":       "shipped",
  "dispatched":              "shipped",
  "in transit":              "shipped",
  "at hub":                  "shipped",
  "out for delivery":        "shipped",
  "on route":                "shipped",
  "picked up":               "shipped",

  // Delivered
  "delivered":               "delivered",
  "delivery confirmed":      "delivered",

  // Failed / return
  "delivery failed":         "not_delivered",
  "undelivered":             "not_delivered",
  "return requested":        "not_delivered",
  "return in transit":       "not_delivered",
  "return at hub":           "not_delivered",
  "return delivered":        "returned",
  "return completed":        "returned",
  "returned":                "returned",

  // Canceled
  "canceled":                "canceled",
  "cancelled":               "canceled",
};

export function mapZRState(stateName) {
  if (!stateName) return null;
  return ZR_STATE_MAP[stateName.toLowerCase().trim()] || null;
}
