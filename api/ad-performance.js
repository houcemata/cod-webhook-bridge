import { requireRole } from "./_auth.js";

const META_GRAPH_VERSION = "v20.0";
const TIKTOK_API_BASE = "https://business-api.tiktok.com";
const USD_TO_DZD = 255;

function toDateOnly(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function money(n) {
  return Number.isFinite(Number(n)) ? Number(n) : 0;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + money(row[key]), 0);
}

function makeDailyBucket(map, date) {
  if (!map.has(date)) {
    map.set(date, {
      date,
      meta_spend: 0,
      meta_impressions: 0,
      meta_clicks: 0,
      tiktok_spend: 0,
      tiktok_impressions: 0,
      tiktok_clicks: 0,
    });
  }
  return map.get(date);
}

function normalizeDailyRows(rows, source, fxRate = 1) {
  return rows
    .map((row) => {
      const metrics = row.metrics || row.metric || row.metrics_data || row.values || row;
      const dims = row.dimensions || row.dimension || row.dimensions_data || row;
      const date =
        dims.date_start ||
        dims.stat_time_day ||
        dims.stat_time ||
        dims.date ||
        dims.day ||
        row.date_start ||
        row.stat_time_day ||
        row.stat_time ||
        row.date ||
        row.day ||
        row.reporting_start_time ||
        row.report_date ||
        "";
      const rawSpend = money(metrics.spend || metrics.cost || metrics.amount_spent || row.spend || row.cost || row.amount_spent || 0);
      return {
        date: toDateOnly(date) || String(date || "").slice(0, 10),
        spend: rawSpend * fxRate,
        impressions: money(metrics.impressions || metrics.impression || row.impressions || row.impression || 0),
        clicks: money(metrics.clicks || metrics.click || row.clicks || row.click || 0),
        source,
      };
    })
    .filter((row) => row.date);
}

async function fetchMetaSummary(from, to) {
  const accountId = String(
    process.env.META_ADS_ACCOUNT_ID || process.env.META_AD_ACCOUNT_ID || ""
  ).replace(/^act_/, "").trim();
  const accessToken = process.env.META_ADS_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;

  if (!accountId || !accessToken) {
    return { provider: "meta", skipped: true, reason: "missing_env", total_spend: 0, daily: [] };
  }

  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/act_${accountId}/insights`);
  url.searchParams.set("fields", "date_start,spend,impressions,clicks");
  url.searchParams.set("level", "account");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({ since: from, until: to }));
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  const rows = Array.isArray(data?.data) ? data.data : [];
  const daily = normalizeDailyRows(rows, "meta", USD_TO_DZD);

  return {
    provider: "meta",
    ok: response.ok,
    status: response.status,
    total_spend: sum(daily, "spend"),
    daily,
    raw: data,
  };
}

function extractTikTokRows(data) {
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.list)) return data.data.list;
  if (Array.isArray(data?.data?.list_data)) return data.data.list_data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.list_data)) return data.list_data;
  return [];
}

async function fetchTikTokSummary(from, to) {
  const advertiserId = String(process.env.TIKTOK_ADVERTISER_ID || process.env.TIKTOK_ACCOUNT_ID || "").trim();
  const accessToken = process.env.TIKTOK_ADS_ACCESS_TOKEN || process.env.TIKTOK_ACCESS_TOKEN;

  if (!advertiserId || !accessToken) {
    return { provider: "tiktok", skipped: true, reason: "missing_env", total_spend: 0, daily: [] };
  }

  const url = new URL(`${TIKTOK_API_BASE}/open_api/v1.3/report/integrated/get/`);
  url.searchParams.set("report_type", "BASIC");
  url.searchParams.set("advertiser_id", advertiserId);
  url.searchParams.set("data_level", "AUCTION_AD");
  url.searchParams.set("dimensions", JSON.stringify(["stat_time_day"]));
  url.searchParams.set("metrics", JSON.stringify(["spend", "impressions", "clicks"]));
  url.searchParams.set("start_date", from);
  url.searchParams.set("end_date", to);
  url.searchParams.set("page", "1");
  url.searchParams.set("page_size", "100");

  const response = await fetch(url, {
    headers: {
      "Access-Token": accessToken,
      Accept: "application/json",
    },
  });
  const data = await response.json().catch(() => ({}));
  const rows = extractTikTokRows(data);
  // TikTok accounts are usually in USD too — apply same rate
  const daily = normalizeDailyRows(rows, "tiktok", USD_TO_DZD);

  return {
    provider: "tiktok",
    ok: response.ok,
    status: response.status,
    total_spend: sum(daily, "spend"),
    daily,
    raw: data,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const from = toDateOnly(req.query.from);
  const to = toDateOnly(req.query.to);
  if (!from || !to) {
    return res.status(400).json({ error: "Missing from/to date range" });
  }

  try {
    const [metaResult, tiktokResult] = await Promise.allSettled([
      fetchMetaSummary(from, to),
      fetchTikTokSummary(from, to),
    ]);

    const meta = metaResult.status === "fulfilled" ? metaResult.value : {
      provider: "meta",
      ok: false,
      error: metaResult.reason?.message || "Meta fetch failed",
      total_spend: 0,
      daily: [],
    };

    const tiktok = tiktokResult.status === "fulfilled" ? tiktokResult.value : {
      provider: "tiktok",
      ok: false,
      error: tiktokResult.reason?.message || "TikTok fetch failed",
      total_spend: 0,
      daily: [],
    };

    const bucket = new Map();
    [...(meta.daily || []), ...(tiktok.daily || [])].forEach((row) => {
      const bucketRow = makeDailyBucket(bucket, row.date);
      if (row.source === "meta") {
        bucketRow.meta_spend += row.spend;
        bucketRow.meta_impressions += row.impressions;
        bucketRow.meta_clicks += row.clicks;
      } else if (row.source === "tiktok") {
        bucketRow.tiktok_spend += row.spend;
        bucketRow.tiktok_impressions += row.impressions;
        bucketRow.tiktok_clicks += row.clicks;
      }
    });

    const daily = [...bucket.values()].sort((a, b) => a.date.localeCompare(b.date));
    const total_spend = daily.reduce((s, row) => s + row.meta_spend + row.tiktok_spend, 0);

    return res.status(200).json({
      period: { from, to },
      meta: { ...meta, total_spend: meta.total_spend || 0 },
      tiktok: { ...tiktok, total_spend: tiktok.total_spend || 0 },
      daily,
      total_spend,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to load ad performance",
      message: err.message || "Unknown error",
    });
  }
}
