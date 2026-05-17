(function () {
  const PHONE_RE = /^0[567]\d{8}$/;
  const STORAGE_PREFIX = "arco-draft-order-id";
  const inFlight = new Map();

  function storageKey(meta = {}) {
    return [
      STORAGE_PREFIX,
      meta.product_slug || "",
      meta.phone || "",
      meta.variant_label || "",
      meta.delivery_type || "",
    ].join(":");
  }

  function cleanPhone(phone) {
    return String(phone || "").replace(/\s+/g, "").trim();
  }

  async function createDraft(payload) {
    const response = await fetch("/api/create-draft-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "draft_capture_failed");
    }
    return data;
  }

  function getStoredDraftId(meta = {}) {
    return localStorage.getItem(storageKey(meta)) || "";
  }

  function clearStoredDraftId(meta = {}) {
    localStorage.removeItem(storageKey(meta));
  }

  function bindDraftCapture(config = {}) {
    const input = document.getElementById(config.phoneInputId || "f-phone");
    if (!input || typeof config.buildPayload !== "function") return false;

    let timer = null;

    const attemptCapture = async () => {
      const payload = config.buildPayload();
      if (!payload) return;

      const phone = cleanPhone(payload.phone);
      if (!PHONE_RE.test(phone)) return;

      const key = storageKey({ ...payload, phone });
      if (inFlight.get(key)) return;

      inFlight.set(key, true);
      try {
        const result = await createDraft({ ...payload, phone, mode: "draft" });
        const draftId = result.draft_order_id || result.order_id || "";
        if (draftId) {
          localStorage.setItem(key, draftId);
          if (typeof config.onCaptured === "function") {
            config.onCaptured(draftId, payload);
          }
        }
      } catch (error) {
        if (typeof config.onError === "function") {
          config.onError(error);
        }
      } finally {
        inFlight.delete(key);
      }
    };

    const scheduleCapture = () => {
      clearTimeout(timer);
      timer = setTimeout(attemptCapture, config.debounceMs || 900);
    };

    input.addEventListener("input", scheduleCapture);
    input.addEventListener("blur", attemptCapture);

    const extraIds = Array.isArray(config.watchInputIds) ? config.watchInputIds : [];
    extraIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el === input) return;
      el.addEventListener("input", scheduleCapture);
      el.addEventListener("change", scheduleCapture);
      el.addEventListener("blur", attemptCapture);
    });

    window.ARCODraft.triggerCapture = scheduleCapture;

    return true;
  }

  window.ARCODraft = {
    bindDraftCapture,
    getStoredDraftId,
    clearStoredDraftId,
    triggerCapture: null,
  };
})();
