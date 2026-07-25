(function () {
  "use strict";

  const KEY = "arco_attribution_v1";
  const MAX = 240;

  function clean(value) {
    return String(value ?? "").trim().slice(0, MAX);
  }

  function readStored() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || "null");
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  function sourceFrom(value) {
    const source = clean(value).toLowerCase();
    if (["meta", "facebook", "fb", "instagram", "ig"].includes(source) || source.includes("facebook") || source.includes("instagram")) return "meta";
    if (["tiktok", "tik-tok", "tt"].includes(source) || source.includes("tiktok")) return "tiktok";
    if (["google", "bing", "youtube", "search"].includes(source)) return "organic";
    if (["organic", "seo"].includes(source)) return "organic";
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

  function capture() {
    const params = new URLSearchParams(location.search);
    const stored = readStored();
    const referrer = clean(document.referrer);
    const explicitSource = sourceFrom(params.get("utm_source"));
    const fbclid = clean(params.get("fbclid"));
    const ttclid = clean(params.get("ttclid"));
    const clickSource = fbclid ? "meta" : ttclid ? "tiktok" : "";
    const source = explicitSource || clickSource || sourceFromReferrer(referrer) || stored.source || (referrer ? "other" : "direct");
    const meaningfulVisit = explicitSource || clickSource || sourceFromReferrer(referrer);
    const current = {
      source,
      medium: clean(params.get("utm_medium") || stored.medium),
      campaign: clean(params.get("utm_campaign") || stored.campaign),
      content: clean(params.get("utm_content") || stored.content),
      term: clean(params.get("utm_term") || stored.term),
      click_id: fbclid || ttclid || clean(stored.click_id),
      landing_page: clean(stored.landing_page || location.href),
      referrer: clean(referrer || stored.referrer),
      captured_at: clean(stored.captured_at || new Date().toISOString()),
    };

    // A new paid/search visit updates attribution; direct navigation does not erase it.
    if (meaningfulVisit || !stored.source) {
      try { localStorage.setItem(KEY, JSON.stringify(current)); } catch {}
    }
    return current;
  }

  const attribution = capture();
  window.ARCOAttribution = {
    getPayload() { return { ...attribution }; },
    refresh() { return capture(); },
  };
})();
