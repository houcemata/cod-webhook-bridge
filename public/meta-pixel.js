(function () {
  const PIXEL_ID = "1491854262320314";

  if (window.fbq) {
    return;
  }

  !(function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    t = b.createElement(e);
    t.async = true;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

  fbq("init", PIXEL_ID);
  fbq("track", "PageView");

  function track(eventName, params, options) {
    if (!window.fbq) return;
    if (options && Object.keys(options).length) {
      window.fbq("track", eventName, params || {}, options);
      return;
    }
    window.fbq("track", eventName, params || {});
  }

  window.ARCOMeta = {
    pixelId: PIXEL_ID,
    trackPageView() {
      track("PageView");
    },
    trackViewContent(input = {}) {
      track("ViewContent", {
        content_name: input.content_name,
        content_ids: input.content_ids || [],
        content_type: input.content_type || "product",
        content_category: input.content_category,
        value: Number(input.value || 0),
        currency: input.currency || "DZD",
      });
    },
    trackInitiateCheckout(input = {}) {
      track("InitiateCheckout", {
        content_name: input.content_name,
        content_ids: input.content_ids || [],
        content_type: input.content_type || "product",
        content_category: input.content_category,
        value: Number(input.value || 0),
        currency: input.currency || "DZD",
      });
    },
    trackPurchase(input = {}) {
      const eventID = input.eventID || input.eventId || input.order_id;
      track("Purchase", {
        content_name: input.content_name,
        content_ids: input.content_ids || [],
        content_type: input.content_type || "product",
        content_category: input.content_category,
        value: Number(input.value || 0),
        currency: input.currency || "DZD",
      }, eventID ? { eventID } : undefined);
    },
  };
})();
