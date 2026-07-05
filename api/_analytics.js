import crypto from "crypto";

function sha256(value) {
  if (!value) return undefined;
  return crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");
}

function cleanPhone(phone) {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("0")) return `213${digits.slice(1)}`;
  return digits;
}

function eventTime() {
  return Math.floor(Date.now() / 1000);
}

export async function sendMetaConversion(input = {}) {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  const testEventCode = process.env.META_TEST_EVENT_CODE;
  if (!pixelId || !accessToken) return { skipped: true, provider: "meta", reason: "missing_env" };

  const eventName = input.event_name || "Purchase";
  const body = {
    data: [{
      event_name: eventName,
      event_time: eventTime(),
      event_id: input.order_id || input.event_id,
      action_source: "website",
      event_source_url: input.event_source_url,
      user_data: {
        ph: sha256(cleanPhone(input.phone)),
        fn: sha256((input.name || "").split(/\s+/)[0]),
        ln: sha256((input.name || "").split(/\s+/).slice(1).join(" ")),
        client_ip_address: input.client_ip_address,
        client_user_agent: input.client_user_agent,
      },
      custom_data: {
        currency: input.currency || "DZD",
        value: Number(input.value || 0),
        content_name: input.product,
        content_category: input.variant,
        order_id: input.order_id,
      },
    }],
  };
  if (testEventCode) body.test_event_code = testEventCode;

  const response = await fetch(`https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { provider: "meta", ok: response.ok, status: response.status, data };
}

export async function sendTikTokEvent(input = {}) {
  const pixelCode = process.env.TIKTOK_PIXEL_CODE || process.env.TIKTOK_PIXEL_ID;
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
  if (!pixelCode || !accessToken) return { skipped: true, provider: "tiktok", reason: "missing_env" };

  const body = {
    event_source: "web",
    event_source_id: pixelCode,
    data: [{
      event: input.event_name || "Purchase",
      event_time: String(eventTime()),
      event_id: input.order_id || input.event_id,
      page: { url: input.event_source_url },
      user: {
        phone: sha256(cleanPhone(input.phone)),
      },
      properties: {
        currency: input.currency || "DZD",
        value: Number(input.value || 0),
        content_name: input.product,
        content_category: input.variant,
        order_id: input.order_id,
      },
    }],
  };

  const response = await fetch("https://business-api.tiktok.com/open_api/v1.3/event/track/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Access-Token": accessToken,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { provider: "tiktok", ok: response.ok, status: response.status, data };
}

export async function sendAllAnalytics(input = {}) {
  const results = await Promise.allSettled([
    sendMetaConversion(input),
    sendTikTokEvent(input),
  ]);
  return results.map(result => result.status === "fulfilled" ? result.value : {
    ok: false,
    error: result.reason?.message || "analytics_failed",
  });
}
