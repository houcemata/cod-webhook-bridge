// ── Shared IP utilities ──────────────────────────────────────────
// Used by create-order.js and create-draft.js

export const IP_BLOCKED_MESSAGE =
  "عذراً، لا يمكن إتمام الطلب. تواصل معنا عبر واتساب إذا كنت تواجه مشكلة.";

export const IP_LIMIT_MESSAGE =
  "لقد وصلت إلى الحد الأقصى للطلبات اليوم (طلبان). جرّب غداً أو تواصل معنا عبر واتساب.";

export function clientIpFromRequest(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return "";
}

// Checks IP via ipwho.is — free, unlimited, no API key.
// Returns { ok: true } if Algerian non-proxy, { ok: false, reason } otherwise.
// Fails OPEN on errors so real customers are never blocked by API downtime.
export async function checkIpCountry(ip) {
  if (!ip) return { ok: false, reason: "no_ip" };
  try {
    const res = await fetch(`https://ipwho.is/${ip}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      console.warn(`[ip-gate] ipwho.is returned ${res.status} for ${ip}, allowing`);
      return { ok: true }; // fail open
    }
    const data = await res.json();
    if (data.is_proxy === true) {
      console.warn(`[ip-gate] blocked proxy/VPN: ${ip} (country: ${data.country_code})`);
      return { ok: false, reason: "proxy" };
    }
    if (data.country_code !== "DZ") {
      console.warn(`[ip-gate] blocked non-DZ: ${ip} (country: ${data.country_code})`);
      return { ok: false, reason: "non_dz" };
    }
    return { ok: true };
  } catch (err) {
    console.warn(`[ip-gate] ipwho.is lookup failed (allowing): ${err.message}`);
    return { ok: true }; // fail open
  }
}
