(function () {
  const PIXEL_ID = "7583091993300140048";

  if (window.ttq) {
    return;
  }

  !(function (w, d, t) {
    w.TiktokAnalyticsObject = t;
    const ttq = (w[t] = w[t] || []);
    ttq.methods = [
      "page",
      "track",
      "identify",
      "instances",
      "debug",
      "on",
      "off",
      "once",
      "ready",
      "alias",
      "group",
      "enableCookie",
      "disableCookie",
    ];
    ttq.setAndDefer = function (target, method) {
      target[method] = function () {
        target.push([method].concat([].slice.call(arguments, 0)));
      };
    };
    for (let i = 0; i < ttq.methods.length; i += 1) {
      ttq.setAndDefer(ttq, ttq.methods[i]);
    }
    ttq.load = function (id, options) {
      const script = "https://analytics.tiktok.com/i18n/pixel/events.js";
      ttq._i = ttq._i || {};
      ttq._i[id] = [];
      ttq._i[id]._u = script;
      ttq._t = ttq._t || {};
      ttq._t[id] = +new Date();
      ttq._o = ttq._o || {};
      ttq._o[id] = options || {};
      const tag = d.createElement("script");
      tag.type = "text/javascript";
      tag.async = true;
      tag.src = `${script}?sdkid=${id}&lib=${t}`;
      const first = d.getElementsByTagName("script")[0];
      first.parentNode.insertBefore(tag, first);
    };
  })(window, document, "ttq");

  window.ttq.load(PIXEL_ID);
  window.ttq.page();

  function track(eventName, params, options) {
    if (!window.ttq || !window.ttq.track) return;
    if (options && Object.keys(options).length) {
      window.ttq.track(eventName, params || {}, options);
      return;
    }
    window.ttq.track(eventName, params || {});
  }

  window.ARCOTikTok = {
    pixelId: PIXEL_ID,
    trackPageView() {
      track("PageView");
    },
    trackViewContent(input = {}) {
      const eventID = input.eventID || input.eventId;
      track(
        "ViewContent",
        {
          content_name: input.content_name,
          content_ids: input.content_ids || [],
          content_type: input.content_type || "product",
          content_category: input.content_category,
          value: Number(input.value || 0),
          currency: input.currency || "DZD",
        },
        eventID ? { event_id: eventID } : undefined
      );
    },
    trackInitiateCheckout(input = {}) {
      const eventID = input.eventID || input.eventId;
      track(
        "InitiateCheckout",
        {
          content_name: input.content_name,
          content_ids: input.content_ids || [],
          content_type: input.content_type || "product",
          content_category: input.content_category,
          value: Number(input.value || 0),
          currency: input.currency || "DZD",
        },
        eventID ? { event_id: eventID } : undefined
      );
    },
    trackPurchase(input = {}) {
      const eventID = input.eventID || input.eventId || input.order_id;
      track(
        "Purchase",
        {
          content_name: input.content_name,
          content_ids: input.content_ids || [],
          content_type: input.content_type || "product",
          content_category: input.content_category,
          value: Number(input.value || 0),
          currency: input.currency || "DZD",
        },
        eventID ? { event_id: eventID } : undefined
      );
    },
  };
})();
