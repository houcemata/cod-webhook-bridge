const MAX = 240;

function clean(value) {
  return String(value ?? "").trim().slice(0, MAX);
}

function sourceFrom(value) {
  const source = clean(value).toLowerCase();
  if (["meta", "facebook", "fb", "instagram", "ig"].includes(source) || source.includes("facebook") || source.includes("instagram")) return "meta";
  if (["tiktok", "tik-tok", "tt"].includes(source) || source.includes("tiktok")) return "tiktok";
  if (["google", "bing", "youtube", "search", "organic", "seo"].includes(source)) return "organic";
  if (["direct", "none"].includes(source)) return "direct";
  return source ? "other" : "";
}

function sourceFromReferrer(referrer) {
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (host.includes("facebook.com") || host.includes("instagram.com") || host.includes("fb.com")) return "meta";
    if (host.includes("tiktok.com")) return "tiktok";
    if (host.includes("google.") || host.includes("bing.com") || host.includes("yahoo.")) return "organic";
  } catch {}
  return "";
}

export function buildAttribution(input = {}, eventSourceUrl = "", requestReferrer = "") {
  const raw = input && typeof input === "object" ? input : {};
  let params;
  try { params = new URL(eventSourceUrl || "").searchParams; } catch { params = new URLSearchParams(); }

  const fbclid = clean(raw.click_id || params.get("fbclid"));
  const ttclid = clean(raw.ttclid || (fbclid ? "" : params.get("ttclid")));
  const referrer = clean(raw.referrer || requestReferrer);
  const source = sourceFrom(raw.source)
    || (fbclid ? "meta" : ttclid ? "tiktok" : "")
    || sourceFromReferrer(referrer)
    || (referrer ? "other" : "direct");

  return {
    attribution_source: source || "unknown",
    attribution_medium: clean(raw.medium || params.get("utm_medium")),
    attribution_campaign: clean(raw.campaign || params.get("utm_campaign")),
    attribution_content: clean(raw.content || params.get("utm_content")),
    attribution_term: clean(raw.term || params.get("utm_term")),
    attribution_click_id: clean(fbclid || ttclid),
    attribution_landing_page: clean(raw.landing_page || eventSourceUrl),
    attribution_referrer: referrer,
    attribution_captured_at: clean(raw.captured_at) || new Date().toISOString(),
  };
}
