/*
 * injected.js — RUNS SAFELY, READ-ONLY (installed at document_start to catch Etsy loading orders).
 * Hooks fetch/XHR only to OBSERVE (clone), never modifying request/response, fully isolating errors.
 */
(function () {
  if (window.__fusionPullerInstalled) return;
  window.__fusionPullerInstalled = true;
  let seen = 0, matched = 0;

  function observe(url, text, ctype) {
    try {
      seen++;
      if (!text || text.length > 8000000) return;
      // only consider JSON (by content-type or starting with { / [)
      const looksJson = (ctype && /json/i.test(ctype)) || /^\s*[[{]/.test(text);
      if (!looksJson) return;
      if (!/receipt_id|receiptId|order_id|orderId|transactions|grandtotal|first_line|country_name|buyer|listing_id/i.test(text)) return;
      const data = JSON.parse(text);
      matched++;
      window.postMessage({ __fusion_etsy__: true, url: String(url || ""), data }, window.location.origin);
      console.log("[FusionPuller] captured order data from:", url, "(total matched:", matched, "/ seen:", seen, ")");
    } catch (_) {}
  }

  try {
    const nativeFetch = window.fetch;
    const wrapped = function (...args) {
      const p = nativeFetch.apply(this, args);
      try {
        p.then((res) => {
          try {
            const url = (args[0] && args[0].url) || args[0] || (res && res.url);
            const ct = res.headers && res.headers.get && res.headers.get("content-type");
            res.clone().text().then((t) => observe(url, t, ct)).catch(() => {});
          } catch (_) {}
        }).catch(() => {});
      } catch (_) {}
      return p;
    };
    try { wrapped.toString = () => nativeFetch.toString(); } catch (_) {}
    window.fetch = wrapped;
  } catch (_) {}

  try {
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, url) { try { this.__fpUrl = url; } catch (_) {} return _open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      try {
        this.addEventListener("load", function () {
          try {
            const rt = this.responseType;
            if (rt === "" || rt === "text") observe(this.__fpUrl, this.responseText, this.getResponseHeader && this.getResponseHeader("content-type"));
            else if (rt === "json" && this.response) observe(this.__fpUrl, JSON.stringify(this.response), "application/json");
          } catch (_) {}
        });
      } catch (_) {}
      return _send.apply(this, arguments);
    };
    try { XMLHttpRequest.prototype.open.toString = () => _open.toString(); XMLHttpRequest.prototype.send.toString = () => _send.toString(); } catch (_) {}
  } catch (_) {}

  // Let the content script query status for diagnostics
  window.addEventListener("message", (ev) => {
    if (ev.data && ev.data.__fusion_ping__) window.postMessage({ __fusion_pong__: true, seen, matched }, window.location.origin);
  });

  console.log("[FusionPuller] hook installed at document_start — open/reload the Orders page to capture orders.");
})();
