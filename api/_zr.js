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

  // ZR paginates at 1000 — fetch all pages
  const allItems = [];
  let pageNumber = 1;
  const pageSize = 1000;

  while (true) {
    const r = await zrPost("/territories/search", {
      pageNumber,
      pageSize,
      orderBy: ["code asc"],
    });
    if (!r.ok) throw new Error(`ZR territories fetch failed: ${r.status}`);
    const items = r.data?.items || [];
    allItems.push(...items);
    const totalCount = r.data?.totalCount || 0;
    if (allItems.length >= totalCount || items.length < pageSize) break;
    pageNumber++;
  }

  const wilayas = allItems.filter(t => t.level === "wilaya").length;
  const communes = allItems.filter(t => t.level === "commune").length;
  console.log(`[zr] territories loaded: ${allItems.length} total (${wilayas} wilayas, ${communes} communes)`);

  _territoriesCache = allItems;
  return allItems;
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

// Static mapping of all common wilaya name variants → wilaya code (1-58)
// Covers Arabic transliterations, French names, English names, common misspellings
const WILAYA_NAME_TO_CODE = {
  // 1
  "adrar": 1,
  // 2
  "chlef": 2, "ech cheliff": 2, "ech-cheliff": 2, "el asnam": 2,
  // 3
  "laghouat": 3,
  // 4
  "oum el bouaghi": 4, "oum el-bouaghi": 4, "oum bouaghi": 4,
  // 5
  "batna": 5,
  // 6
  "bejaia": 6, "bejaia": 6, "bgayet": 6, "béjaïa": 6,
  // 7
  "biskra": 7,
  // 8
  "bechar": 8, "béchar": 8,
  // 9
  "blida": 9,
  // 10
  "bouira": 10,
  // 11
  "tamanrasset": 11, "tamanghasset": 11,
  // 12
  "tebessa": 12, "tébessa": 12,
  // 13
  "tlemcen": 13,
  // 14
  "tiaret": 14,
  // 15
  "tizi ouzou": 15, "tizi-ouzou": 15,
  // 16
  "alger": 16, "algiers": 16, "el djazair": 16,
  // 17
  "djelfa": 17,
  // 18
  "jijel": 18,
  // 19
  "setif": 19, "sétif": 19,
  // 20
  "saida": 20, "saïda": 20,
  // 21
  "skikda": 21,
  // 22
  "sidi bel abbes": 22, "sidi bel abbès": 22, "sidi bel-abbes": 22,
  // 23
  "annaba": 23,
  // 24
  "guelma": 24,
  // 25
  "constantine": 25,
  // 26
  "medea": 26, "médéa": 26,
  // 27
  "mostaganem": 27,
  // 28
  "msila": 28, "m sila": 28, "m'sila": 28,
  // 29
  "mascara": 29,
  // 30
  "ouargla": 30,
  // 31
  "oran": 31,
  // 32
  "el bayadh": 32,
  // 33
  "illizi": 33,
  // 34
  "bordj bou arreridj": 34, "bordj bou-arreridj": 34, "bba": 34,
  // 35
  "boumerdes": 35, "boumerdès": 35,
  // 36
  "el tarf": 36,
  // 37
  "tindouf": 37,
  // 38
  "tissemsilt": 38,
  // 39
  "el oued": 39,
  // 40
  "khenchela": 40,
  // 41
  "souk ahras": 41,
  // 42
  "tipaza": 42, "tipasa": 42,
  // 43
  "mila": 43,
  // 44
  "ain defla": 44, "aïn defla": 44,
  // 45
  "naama": 45, "naâma": 45,
  // 46
  "ain temouchent": 46, "aïn témouchent": 46,
  // 47
  "ghardaia": 47, "ghardaïa": 47,
  // 48
  "relizane": 48,
  // 49
  "timimoun": 49,
  // 50
  "bordj badji mokhtar": 50,
  // 51
  "ouled djellal": 51,
  // 52
  "beni abbes": 52, "béni abbès": 52,
  // 53
  "in salah": 53, "in-salah": 53,
  // 54
  "in guezzam": 54, "in-guezzam": 54,
  // 55
  "touggourt": 55,
  // 56
  "djanet": 56,
  // 57
  "el meghaier": 57, "el-meghaier": 57,
  // 58
  "el meniaa": 58, "el-meniaa": 58,
};

export async function findWilayaId(wilayaName) {
  const territories = await getTerritories();
  const wilayas = territories.filter(t => t.level === "wilaya");
  const query = normStr(wilayaName);

  // 1) exact normalised match against ZR names
  let match = wilayas.find(w => normStr(w.name) === query);

  // 2) static code lookup (covers English names, variants, misspellings)
  if (!match) {
    const code = WILAYA_NAME_TO_CODE[query];
    if (code) match = wilayas.find(w => w.code === code);
  }

  // 3) numeric code match (e.g. "16" → Alger)
  if (!match) {
    const code = parseInt(wilayaName);
    if (!isNaN(code)) match = wilayas.find(w => w.code === code);
  }

  // 4) contains match as last resort
  if (!match) match = wilayas.find(w => normStr(w.name).includes(query) || query.includes(normStr(w.name)));

  if (!match) console.warn(`[zr] wilaya not found: "${wilayaName}" (normalized: "${query}")`);

  return match?.id || null;
}

export async function findCommuneId(wilayaId, communeName) {
  const territories = await getTerritories();
  const communes = territories.filter(t => t.level === "commune" && t.parentId === wilayaId);

  if (communes.length === 0) {
    console.warn(`[zr] no communes found for wilayaId ${wilayaId}`);
    return null;
  }

  const query = normStr(communeName);

  // 1) exact match after full normalization (strips accents, lowercase)
  let match = communes.find(c => normStr(c.name) === query);
  // 2) also try matching against Arabic name
  if (!match) match = communes.find(c => normStr(c.nameArabic || "") === query);
  // 3) contains match
  if (!match) match = communes.find(c => normStr(c.name).includes(query) || query.includes(normStr(c.name)));
  // 4) postal code match (e.g. commune entered as "16001")
  if (!match) match = communes.find(c => c.postalCode === communeName.trim());

  if (!match) {
    console.warn(`[zr] commune not found: "${communeName}" in wilaya ${wilayaId}. Available: ${communes.map(c => c.name).join(", ")}`);
  }

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
// ZR sends French state names (both spaced and snake_case variants).
// Source: ZR Express API docs + observed webhook payloads.
export const ZR_STATE_MAP = {
  // ── In transit / processing ────────────────────────────────────
  "commande_recue":                      "shipped",  // order received
  "commande_confirmee":                  "shipped",  // order confirmed
  "pret a expedier":                     "shipped",  // ready to dispatch
  "pret_a_expedier":                     "shipped",
  "ready to dispatch":                   "shipped",
  "dispatch":                            "shipped",
  "en_traitement":                       "shipped",  // in processing
  "en traitement":                       "shipped",
  "colis_recuperer":                     "shipped",  // parcel picked up from supplier
  "recupere par fournisseur":            "shipped",
  "attente recuperation fournisseur":    "shipped",  // waiting for supplier pickup
  "sortie en livraison":                 "shipped",  // out for delivery
  "en_livraison":                        "shipped",
  "en livraison":                        "shipped",
  "on route":                            "shipped",
  "on-route":                            "shipped",
  "out for delivery":                    "shipped",
  "vers_wilaya":                         "shipped",  // towards wilaya
  "scan":                                "shipped",  // scanned at hub
  "encaisse":                            "shipped",  // collected/processed
  "reinjecte dans stock":                "shipped",  // reinjected
  "in transit":                          "shipped",
  "at hub":                              "shipped",
  "dispatched":                          "shipped",
  "order received":                      "shipped",
  "picked up":                           "shipped",

  // ── Delivered ──────────────────────────────────────────────────
  "livre":                               "delivered",
  "livré":                               "delivered",
  "confirme au bureau":                  "delivered",  // confirmed at stop desk
  "traitee":                             "delivered",  // processed/settled
  "delivered":                           "delivered",
  "delivery confirmed":                  "delivered",

  // ── Failed attempts (not delivered yet, still active) ──────────
  "appel_confirmation":                  "shipped",   // confirmation call
  "appel telephonique":                  "shipped",   // phone call attempt
  "appel téléphonique":                  "shipped",
  "sms_envoye":                          "shipped",   // SMS sent
  "injoignable":                         "shipped",   // unreachable
  "ne repond pas_1":                     "shipped",   // no answer attempt 1
  "ne repond pas_2":                     "shipped",   // no answer attempt 2
  "ne repond pas_3":                     "not_delivered", // no answer attempt 3 → give up
  "reporter a une date ulterieure":      "shipped",   // postponed
  "reporté à une date ultérieure":       "shipped",
  "commune_erronee":                     "shipped",   // wrong commune
  "commune erronée":                     "shipped",

  // ── Return / failed terminal ───────────────────────────────────
  "commande_anullee":                    "canceled",
  "commande annulée":                    "canceled",
  "canceled":                            "canceled",
  "cancelled":                           "canceled",
  "annule":                              "canceled",
  "retour":                              "not_delivered",
  "en attente dechange":                 "not_delivered", // awaiting exchange
  "return requested":                    "not_delivered",
  "return in transit":                   "not_delivered",
  "return at hub":                       "not_delivered",
  "delivery failed":                     "not_delivered",
  "undelivered":                         "not_delivered",
  "returned":                            "returned",
  "return delivered":                    "returned",
  "return completed":                    "returned",
};

export function mapZRState(stateName) {
  if (!stateName) return null;
  const normalized = stateName.toLowerCase().trim();
  // Try exact match first
  if (ZR_STATE_MAP[normalized]) return ZR_STATE_MAP[normalized];
  // Try with diacritics stripped (e.g. "livré" → "livre")
  const stripped = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return ZR_STATE_MAP[stripped] || null;
}
