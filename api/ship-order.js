import { requireRole } from "./_auth.js";

const NOEST_BASE = "https://app.noest-dz.com/api/public";

const WILAYA_MAP = {
  adrar: 1, chlef: 2, laghouat: 3, "oum el bouaghi": 4, batna: 5,
  bejaia: 6, biskra: 7, bechar: 8, blida: 9, bouira: 10,
  tamanrasset: 11, tebessa: 12, tlemcen: 13, tiaret: 14, "tizi ouzou": 15,
  alger: 16, djelfa: 17, jijel: 18, setif: 19, saida: 20,
  skikda: 21, "sidi bel abbes": 22, annaba: 23, guelma: 24, constantine: 25,
  medea: 26, mostaganem: 27, msila: 28, mascara: 29, ouargla: 30,
  oran: 31, "el bayadh": 32, illizi: 33, "bordj bou arreridj": 34, boumerdes: 35,
  "el tarf": 36, tindouf: 37, tissemsilt: 38, "el oued": 39, khenchela: 40,
  "souk ahras": 41, tipaza: 42, mila: 43, "ain defla": 44, naama: 45,
  "ain temouchent": 46, ghardaia: 47, relizane: 48, timimoun: 49,
  "bordj badji mokhtar": 50, "ouled djellal": 51, "beni abbes": 52,
  "in salah": 53, "in guezzam": 54, touggourt: 55, djanet: 56,
  "el meghaier": 57, "el meniaa": 58,
};

function getWilayaId(wilayaName) {
  if (!wilayaName) return null;
  const cleaned = String(wilayaName)
    .toLowerCase()
    .trim()
    .replace("algiers", "alger")
    .replace(/^\d+\s*-\s*/, "")
    .replace(/\s*Ø§Ù„Ø¬Ø²Ø§Ø¦Ø±\s*/, "")
    .trim();
  return WILAYA_MAP[cleaned] || null;
}

async function noestPost(endpoint, body, token) {
  const response = await fetch(`${NOEST_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

async function updateSupabase(orderId, fields) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  await fetch(`${url}/rest/v1/orders?id=eq.${orderId}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(fields),
  });
}

async function logHistory(orderRef, oldStatus, newStatus, changedBy) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  await fetch(`${url}/rest/v1/order_history`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      order_id: orderRef,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy || "operator",
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireRole(req, ["operator", "admin"]);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const { orderId, order, stationCode } = req.body || {};
  if (!orderId || !order) {
    return res.status(400).json({ error: "Missing orderId or order data" });
  }

  const noestToken = process.env.NOEST_API_KEY;
  const noestGuid = process.env.NOEST_GUID;
  if (!noestToken || !noestGuid) {
    return res.status(500).json({ error: "Noest credentials not configured" });
  }

  const wilayaId = getWilayaId(order.wilaya);
  if (!wilayaId) {
    return res.status(400).json({
      error: `Unknown wilaya: "${order.wilaya}". Please edit the order and fix the wilaya first.`,
    });
  }

  const isStopDesk = order.type_livraison === "pickup";
  const noestPayload = {
    user_guid: noestGuid,
    reference: order.order_id,
    client: order.name,
    phone: String(order.phone || "").replace(/\s/g, ""),
    adresse: order.commune || order.wilaya,
    wilaya_id: wilayaId,
    commune: order.commune || "",
    montant: parseFloat(order.prix_total || 0),
    produit: order.product + (order.variable ? ` - ${order.variable}` : ""),
    type_id: 1,
    stop_desk: isStopDesk ? 1 : 0,
    can_open: 1,
    poids: 0.5,
    ...(isStopDesk && stationCode ? { station_code: stationCode } : {}),
  };

  const createRes = await noestPost("/create/order", noestPayload, noestToken);
  if (!createRes.ok || !createRes.data?.success) {
    const errMsg = createRes.data?.message || JSON.stringify(createRes.data) || "Noest create failed";
    console.error("Noest create error:", errMsg);
    return res.status(400).json({ error: errMsg });
  }

  const tracking = createRes.data.tracking;
  if (!tracking) {
    return res.status(400).json({ error: "No tracking number returned from Noest" });
  }

  await updateSupabase(orderId, {
    status: "shipped",
    tracking_number: tracking,
    shipping_agency: "noest",
  });

  await logHistory(
    order.order_id,
    "confirmed",
    "shipped",
    auth.role?.name || auth.role?.email || auth.user?.email || auth.role?.role || "operator"
  );

  return res.status(200).json({
    success: true,
    tracking_number: tracking,
  });
}
