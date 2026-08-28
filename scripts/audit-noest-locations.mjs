import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildNoestCommuneIndex,
  fetchNoestCommunes,
  normalizeLocationKey,
  resolveCommuneFromIndex,
  resolveWilayaId,
  summarizeNoestCommunes,
} from "../lib/noest-locations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function extractOperatorWilayaData() {
  const html = fs.readFileSync(path.join(root, "public", "operator.html"), "utf8");
  const match = html.match(/const WILAYA_DATA\s*=\s*({[\s\S]*?});\s*const WILAYA_NAMES/);
  if (!match) throw new Error("Could not find WILAYA_DATA in public/operator.html");
  return Function(`"use strict"; return (${match[1]});`)();
}

const token = process.env.NOEST_API_KEY;
if (!token) {
  console.error("Set NOEST_API_KEY before running this audit.");
  process.exit(1);
}

const wilayaData = extractOperatorWilayaData();
const noestRows = await fetchNoestCommunes(token, { force: true });

function auditCrmAgainstNoest(wilayaData, noestRows) {
  const index = buildNoestCommuneIndex(noestRows);
  const rows = [];
  const invalid = [];
  const fuzzy = [];
  const missingWilayas = [];

  for (const [crmWilaya, communes] of Object.entries(wilayaData || {})) {
    const wilayaId = resolveWilayaId(crmWilaya);
    if (!wilayaId) {
      missingWilayas.push(crmWilaya);
      for (const crmCommune of communes || []) invalid.push({ crmWilaya, crmCommune, error: "Unknown CRM wilaya" });
      continue;
    }
    for (const crmCommune of communes || []) {
      const resolved = resolveCommuneFromIndex(index, wilayaId, crmCommune);
      const row = {
        wilayaId,
        crmWilaya,
        crmCommune,
        normalized: normalizeLocationKey(crmCommune),
        ok: resolved.ok,
        noestCommune: resolved.commune || "",
        method: resolved.method || "invalid",
        error: resolved.error || "",
        suggestions: resolved.suggestions || [],
      };
      rows.push(row);
      if (!resolved.ok) invalid.push(row);
      if (resolved.method === "fuzzy") fuzzy.push(row);
    }
  }

  const noestByWilaya = new Map();
  for (const row of noestRows || []) {
    const wilayaId = Number(row?.wilaya_id || row?.wilaya || row?.wilayaId || 0);
    const name = row?.nom || row?.name || row?.commune || row?.label || "";
    if (!wilayaId || !name || row?.is_active === 0 || row?.active === 0) continue;
    if (!noestByWilaya.has(wilayaId)) noestByWilaya.set(wilayaId, []);
    noestByWilaya.get(wilayaId).push(name);
  }

  const crmKeysByWilaya = new Map();
  for (const row of rows) {
    if (!row.ok) continue;
    if (!crmKeysByWilaya.has(row.wilayaId)) crmKeysByWilaya.set(row.wilayaId, new Set());
    crmKeysByWilaya.get(row.wilayaId).add(normalizeLocationKey(row.noestCommune));
  }

  const noestOnly = [];
  for (const [wilayaId, names] of noestByWilaya.entries()) {
    const crmKeys = crmKeysByWilaya.get(wilayaId) || new Set();
    for (const name of names) {
      if (!crmKeys.has(normalizeLocationKey(name))) noestOnly.push({ wilayaId, noestCommune: name });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      crmWilayas: Object.keys(wilayaData || {}).length,
      crmCommunes: rows.length,
      noestCommunes: noestRows.length,
      noestWilayas: summarizeNoestCommunes(noestRows).length,
      matched: rows.filter((row) => row.ok).length,
      exact: rows.filter((row) => row.method === "exact").length,
      fuzzy: fuzzy.length,
      invalid: invalid.length,
      noestOnly: noestOnly.length,
      missingWilayas: missingWilayas.length,
    },
    invalid,
    fuzzy,
    missingWilayas,
    noestOnly,
    rows,
    noestSummary: summarizeNoestCommunes(noestRows),
  };
}

const report = auditCrmAgainstNoest(wilayaData, noestRows);

const outPath = path.join(root, "NOEST_LOCATION_AUDIT.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

console.log(JSON.stringify({
  output: outPath,
  summary: report.summary,
  invalidPreview: report.invalid.slice(0, 20),
  fuzzyPreview: report.fuzzy.slice(0, 20),
}, null, 2));
