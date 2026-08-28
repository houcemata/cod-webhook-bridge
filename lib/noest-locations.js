const NOEST_BASE = "https://app.noest-dz.com/api/public";
const CACHE_TTL_MS = 60 * 60 * 1000;

const WILAYA_MAP = {
  adrar: 1, chlef: 2, laghouat: 3, "oum el bouaghi": 4, batna: 5,
  bejaia: 6, biskra: 7, bechar: 8, blida: 9, bouira: 10,
  tamanrasset: 11, tebessa: 12, tlemcen: 13, tiaret: 14, "tizi ouzou": 15,
  alger: 16, algiers: 16, djelfa: 17, jijel: 18, setif: 19, saida: 20,
  skikda: 21, "sidi bel abbes": 22, annaba: 23, guelma: 24, constantine: 25,
  medea: 26, mostaganem: 27, msila: 28, mascara: 29, ouargla: 30,
  oran: 31, "el bayadh": 32, illizi: 33, "bordj bou arreridj": 34, boumerdes: 35,
  "el tarf": 36, tindouf: 37, tissemsilt: 38, "el oued": 39, khenchela: 40,
  "souk ahras": 41, tipaza: 42, mila: 43, "ain defla": 44, naama: 45,
  "ain temouchent": 46, ghardaia: 47, relizane: 48, timimoun: 49,
  "bordj badji mokhtar": 50, "ouled djellal": 51, "beni abbes": 52,
  "in salah": 53, "in guezzam": 54, touggourt: 55, djanet: 56,
  "el meghaier": 57, "el mghair": 57, "el m ghair": 57, "el m ghaier": 57, "el meniaa": 58, "el menia": 58,
};

const WILAYA_ALIASES = {
  "bordj bou arriedj": 34,
  "bordj bou arreridj": 34,
  "bordj baji mokhtar": 50,
  "bordj badji mokhtar": 50,
  "ain salah": 53,
  "ain guezzam": 54,
  "m sila": 28,
  "m'sila": 28,
  "sidi bel abbes": 22,
  "oum el bouaghi": 4,
  "أدرار": 1, "الشلف": 2, "الأغواط": 3, "ام البواقي": 4, "باتنة": 5,
  "بجاية": 6, "بسكرة": 7, "بشار": 8, "البليدة": 9, "البويرة": 10,
  "تمنراست": 11, "تبسة": 12, "تلمسان": 13, "تيارت": 14, "تيزي وزو": 15,
  "الجزائر": 16, "الجلفة": 17, "جيجل": 18, "سطيف": 19, "سعيدة": 20,
  "سكيكدة": 21, "سيدي بلعباس": 22, "عنابة": 23, "قالمة": 24, "قسنطينة": 25,
  "المدية": 26, "مستغانم": 27, "المسيلة": 28, "معسكر": 29, "ورقلة": 30,
  "وهران": 31, "البيض": 32, "اليزي": 33, "برج بوعريريج": 34, "بومرداس": 35,
  "الطارف": 36, "تندوف": 37, "تيسمسيلت": 38, "الوادي": 39, "خنشلة": 40,
  "سوق اهراس": 41, "تيبازة": 42, "ميلة": 43, "عين الدفلى": 44, "النعامة": 45,
  "عين تموشنت": 46, "غرداية": 47, "غليزان": 48, "تيميمون": 49,
  "برج باجي مختار": 50, "أولاد جلال": 51, "بني عباس": 52, "عين صالح": 53,
  "عين قزام": 54, "تقرت": 55, "جانت": 56, "المغير": 57, "المنيعة": 58,
};

const COMMUNE_MANUAL_ALIASES = {
  1: {
    "ouled ahmed tammi": "O Ahmed Timmi",
  },
  3: {
    "el kheneg": "Kheneg",
  },
  4: {
    "el fedjoudj boughrara saoudi": "El Fedjoudj Boughrar",
  },
  5: {
    "m doukel": "Amdoukal",
  },
  6: {
    "ait djellil": "Beni Djellil",
  },
  8: {
    "mechraa houari boumedienne": "Mechraa Houari B",
  },
  14: {
    "zmalet el emir abdelkade": "Zmalet El Emir Aek",
  },
  15: {
    "agouni gueghrane": "Aghni Goughran",
  },
  16: {
    "herraoua": "Haraoua",
    "kheraisia": "Khracia",
    "sehaoula": "Saoula",
  },
};

let communeCache = null;

export function decodeMojibake(value) {
  let text = String(value || "");
  for (let i = 0; i < 2 && /[ÃƒÃ‚Â]/.test(text); i += 1) {
    try {
      text = new TextDecoder("utf-8").decode(Uint8Array.from(text, (ch) => ch.charCodeAt(0)));
    } catch {
      break;
    }
  }
  return text;
}

export function stripDiacritics(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeLocationKey(value) {
  return stripDiacritics(decodeMojibake(value))
    .toLowerCase()
    .trim()
    .replace(/[’‘`´]/g, "'")
    .replace(/[ـ]/g, "")
    .replace(/^\d+\s*-\s*/, "")
    .replace(/\b(wilaya|province|commune|daira|de|d')\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveWilayaId(wilayaName) {
  const key = normalizeLocationKey(wilayaName);
  return WILAYA_MAP[key] || WILAYA_ALIASES[key] || null;
}

function noestHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function fetchJson(path, token) {
  const response = await fetch(`${NOEST_BASE}${path}`, { headers: noestHeader(token) });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`Noest ${path} failed with HTTP ${response.status}: ${typeof data === "string" ? data.slice(0, 180) : JSON.stringify(data)}`);
  }
  return data;
}

export async function fetchNoestCommunes(token, { force = false } = {}) {
  if (!token) throw new Error("NOEST_API_KEY is required to fetch Noest communes");
  const now = Date.now();
  if (!force && communeCache && now - communeCache.loadedAt < CACHE_TTL_MS) return communeCache.rows;

  let rows = await fetchJson("/get/communes", token);
  if (!Array.isArray(rows) || !rows.length) {
    const nested = [];
    for (let wilayaId = 1; wilayaId <= 58; wilayaId += 1) {
      const part = await fetchJson(`/get/communes/${wilayaId}`, token);
      if (Array.isArray(part)) nested.push(...part);
    }
    rows = nested;
  }

  if (!Array.isArray(rows)) throw new Error("Noest communes response was not an array");
  communeCache = { loadedAt: now, rows };
  return rows;
}

function getCommuneName(row) {
  return row?.nom || row?.name || row?.commune || row?.label || "";
}

function getCommuneWilayaId(row) {
  return Number(row?.wilaya_id || row?.wilaya || row?.wilayaId || 0) || null;
}

function isActiveCommune(row) {
  return row?.is_active !== 0 && row?.active !== 0 && row?.is_active !== false && row?.active !== false;
}

function communeVariants(name) {
  const key = normalizeLocationKey(name);
  const variants = new Set([key]);
  variants.add(key.replace(/\bain\b/g, "aïn"));
  variants.add(key.replace(/\bbeni\b/g, "bni"));
  variants.add(key.replace(/\bbni\b/g, "beni"));
  variants.add(key.replace(/\bel\s+/g, "el"));
  variants.add(key.replace(/\bel/g, "el "));
  variants.add(key.replace(/\bm\s+/g, "m"));
  variants.add(key.replace(/\bm\b/g, "m "));
  return [...variants].map(normalizeLocationKey).filter(Boolean);
}

export function buildNoestCommuneIndex(rows) {
  const byWilaya = new Map();
  const postalByWilaya = new Map();
  const global = new Map();
  for (const row of rows || []) {
    if (!isActiveCommune(row)) continue;
    const wilayaId = getCommuneWilayaId(row);
    const name = getCommuneName(row);
    if (!wilayaId || !name) continue;
    if (!byWilaya.has(wilayaId)) byWilaya.set(wilayaId, new Map());
    if (!postalByWilaya.has(wilayaId)) postalByWilaya.set(wilayaId, new Map());
    for (const key of communeVariants(name)) {
      if (!byWilaya.get(wilayaId).has(key)) byWilaya.get(wilayaId).set(key, []);
      byWilaya.get(wilayaId).get(key).push(row);
      if (!global.has(key)) global.set(key, []);
      global.get(key).push(row);
    }
    const postal = String(row.code_postal || row.zip_code || "").trim();
    if (postal) postalByWilaya.get(wilayaId).set(postal, row);
  }
  return { byWilaya, postalByWilaya, global };
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

function exactRow(rows) {
  const unique = [...new Map(rows.map((row) => [getCommuneName(row), row])).values()];
  return unique.length === 1 ? unique[0] : null;
}

export function resolveCommuneFromIndex(index, wilayaId, commune) {
  const raw = String(commune || "").trim();
  if (!raw) return { ok: true, commune: "", method: "empty" };

  const byKey = index.byWilaya.get(Number(wilayaId));
  if (!byKey) return { ok: false, error: `No active Noest communes found for wilaya ${wilayaId}` };

  const postal = index.postalByWilaya.get(Number(wilayaId))?.get(raw);
  if (postal) return { ok: true, commune: getCommuneName(postal), zip_code: raw, method: "postal" };

  const key = normalizeLocationKey(raw);
  const manualAlias = COMMUNE_MANUAL_ALIASES[Number(wilayaId)]?.[key];
  if (manualAlias) {
    const aliasRow = exactRow(byKey.get(normalizeLocationKey(manualAlias)) || []);
    if (aliasRow) return { ok: true, commune: getCommuneName(aliasRow), wilayaId, method: "manual_alias" };
  }

  const direct = exactRow(byKey.get(key) || []);
  if (direct) return { ok: true, commune: getCommuneName(direct), wilayaId, method: "exact" };

  const globalDirect = exactRow(index.global?.get(key) || []);
  if (globalDirect) {
    return {
      ok: true,
      commune: getCommuneName(globalDirect),
      wilayaId: getCommuneWilayaId(globalDirect),
      method: "moved_wilaya",
    };
  }

  const candidates = [];
  for (const [candidateKey, rows] of byKey.entries()) {
    if (!candidateKey) continue;
    const distance = levenshtein(key, candidateKey);
    const limit = Math.max(key.length, candidateKey.length) <= 8 ? 1 : 2;
    if (distance <= limit) {
      const row = exactRow(rows);
      if (row) candidates.push({ row, distance, key: candidateKey });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key));
  if (candidates.length === 1 || (candidates[0] && candidates[1] && candidates[0].distance < candidates[1].distance)) {
    return { ok: true, commune: getCommuneName(candidates[0].row), wilayaId, method: "fuzzy", distance: candidates[0].distance };
  }

  const globalCandidates = [];
  for (const [candidateKey, rows] of index.global?.entries?.() || []) {
    if (!candidateKey) continue;
    const distance = levenshtein(key, candidateKey);
    const limit = Math.max(key.length, candidateKey.length) <= 8 ? 1 : 2;
    if (distance <= limit) {
      const row = exactRow(rows);
      if (row) globalCandidates.push({ row, distance, key: candidateKey });
    }
  }
  globalCandidates.sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key));
  if (globalCandidates.length === 1 || (globalCandidates[0] && globalCandidates[1] && globalCandidates[0].distance < globalCandidates[1].distance)) {
    return {
      ok: true,
      commune: getCommuneName(globalCandidates[0].row),
      wilayaId: getCommuneWilayaId(globalCandidates[0].row),
      method: "moved_wilaya_fuzzy",
      distance: globalCandidates[0].distance,
    };
  }

  return {
    ok: false,
    error: `No active Noest commune match for "${raw}" in wilaya ${wilayaId}`,
    suggestions: candidates.slice(0, 5).map((c) => getCommuneName(c.row)),
  };
}

export async function resolveCommuneForNoest({ token, wilayaId, commune }) {
  const rows = await fetchNoestCommunes(token);
  const index = buildNoestCommuneIndex(rows);
  return resolveCommuneFromIndex(index, wilayaId, commune);
}

export function summarizeNoestCommunes(rows) {
  const byWilaya = new Map();
  for (const row of rows || []) {
    const wilayaId = getCommuneWilayaId(row);
    if (!wilayaId) continue;
    if (!byWilaya.has(wilayaId)) byWilaya.set(wilayaId, { total: 0, active: 0 });
    const item = byWilaya.get(wilayaId);
    item.total += 1;
    if (isActiveCommune(row)) item.active += 1;
  }
  return [...byWilaya.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([wilaya_id, counts]) => ({ wilaya_id, ...counts }));
}
