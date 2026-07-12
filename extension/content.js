/*
 * content.js — inject hook + a full FLOATING CONTROL PANEL on the page (no need to click the extension icon).
 * Runs at document_start.
 */
(function () {
  var DEFAULT_INGEST = "https://os.fusiondn.com/api/ingest/etsy";
  // 1) Inject injected.js early
  try {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("injected.js");
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  } catch (e) { console.error("[FusionPuller] inject fail", e); }

  // 2) Receive data from the page → background
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (d && d.__fusion_etsy__ === true) chrome.runtime.sendMessage({ type: "etsy-data", url: d.url, data: d.data });
  });

  // 3) Scan embedded JSON (fallback)
  function scanEmbedded() {
    let hit = 0;
    try {
      for (const sc of document.querySelectorAll("script")) {
        const txt = sc.textContent || "";
        if (txt.length < 40 || txt.length > 8000000) continue;
        if (!/receipt_id|receiptId|order_id|orderId|transactions|grandtotal|first_line|country_name/i.test(txt)) continue;
        const t = txt.trim();
        const tryParse = (str) => { try { chrome.runtime.sendMessage({ type: "etsy-data", url: "embedded", data: JSON.parse(str) }); hit++; return true; } catch (_) { return false; } };
        if ((t[0] === "{" || t[0] === "[") && tryParse(t)) continue;
        const m = t.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/);
        if (m) tryParse(m[1]);
      }
    } catch (_) {}
    return hit;
  }


  // List compact "field paths" from a sample object (collapsing array items) → easy to share with a dev.
  function keyPaths(obj) {
    const lines = [], seen = new Set();
    (function walk(node, path, depth) {
      if (depth > 6 || node == null) return;
      if (Array.isArray(node)) { if (node.length) walk(node[0], path + "[]", depth + 1); return; }
      if (typeof node === "object") { for (const k in node) walk(node[k], path ? path + "." + k : k, depth + 1); return; }
      const val = (typeof node === "number") ? node : (typeof node === "boolean" ? node : "«str»");
      if (seen.has(path)) return; seen.add(path);
      lines.push(path + " = " + val);
    })(obj, "", 0);
    const KW = /(^|[._[])(order_id|receipt_id|id)($|[._[])|name|address|first_line|second_line|line1|line2|city|state|province|region|zip|postal|country|title|product|listing|price|amount|divisor|total|subtotal|quantity|qty|image|img|photo|thumb|url|personal|variation|variant|sku|buyer|recipient|ship|formatted/i;
    const keep = lines.filter((l) => KW.test(l.split(" = ")[0]));
    return "# RELEVANT FIELDS ONLY (Etsy order-management)\n" + keep.slice(0, 90).join("\n");
  }

  if (window.top !== window) return; // only build UI on the top frame

  // 4) Floating control panel
  const S = document.createElement("style");
  S.textContent = `
    #fp-panel{position:fixed;z-index:2147483647;right:18px;bottom:18px;width:300px;background:#fff;border-radius:14px;
      box-shadow:0 14px 40px rgba(6,20,50,.35);font:13px/1.45 system-ui,-apple-system,sans-serif;color:#1e2a3a;overflow:hidden}
    #fp-hd{background:linear-gradient(135deg,#0095e8,#003c84);color:#fff;padding:9px 12px;display:flex;align-items:center;gap:8px;cursor:move;user-select:none}
    #fp-hd b{font-size:13.5px;flex:1}
    #fp-hd .fp-btn{background:rgba(255,255,255,.2);border:0;color:#fff;width:24px;height:24px;border-radius:7px;cursor:pointer;font-size:14px;line-height:1}
    #fp-bd{padding:12px}
    #fp-cnt{font-weight:800;color:#15803d;margin-bottom:10px;font-size:14px}
    #fp-panel button.act{width:100%;border:0;border-radius:10px;padding:11px;font-weight:800;font-size:13.5px;cursor:pointer;color:#fff;margin-top:8px}
    .fp-sync{background:linear-gradient(135deg,#22c55e,#15803d)}
    .fp-cfgtoggle{background:none;border:0;color:#0095e8;font-weight:700;cursor:pointer;font-size:12.5px;margin-top:10px;padding:0}
    #fp-cfg{display:none;margin-top:10px;border-top:1px solid #eef1f4;padding-top:10px}
    #fp-cfg label{display:block;font-weight:700;font-size:11px;color:#33445a;margin:8px 0 3px}
    #fp-cfg input{width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #dbe1e8;border-radius:8px;font:inherit;font-size:12px}
    #fp-cfg .r{display:flex;gap:6px;margin-top:8px}
    #fp-cfg .r button{flex:1;border:0;border-radius:8px;padding:8px;font-weight:700;font-size:12px;cursor:pointer}
    .fp-save{background:#003c84;color:#fff}.fp-copy{background:#eef1f4;color:#33445a}
    #fp-msg{display:none;margin-top:9px;font-size:12px;padding:7px 9px;border-radius:8px}
    .fp-badge{display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;font:700 11px system-ui;vertical-align:middle}
    .fp-badge.copy{cursor:pointer}
    #fp-track{margin-top:10px}
    #fp-track .h{font-weight:800;font-size:12px;color:#33445a;margin-bottom:4px}
    #fp-track .row{display:flex;align-items:center;gap:6px;padding:5px 0;border-top:1px solid #eef1f4;font-size:11.5px}
    #fp-track .row .id{font-weight:700;color:#0f1e33}
    #fp-track .row .tk{flex:1;color:#5a6272;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #fp-track .row button{border:0;border-radius:7px;padding:4px 8px;font-weight:700;font-size:11px;cursor:pointer;background:#eef1f4;color:#33445a}
    #fp-pill{position:fixed;z-index:2147483647;right:18px;bottom:18px;background:#003c84;color:#fff;border-radius:999px;
      padding:9px 14px;font:800 13px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.3);cursor:pointer;display:none;align-items:center;gap:8px}
  `;
  document.documentElement.appendChild(S);

  const _svg = (inner, sz) => '<svg width="' + (sz||13) + '" height="' + (sz||13) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px">' + inner + '</svg>';
  const IC_PUSH = _svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>');
  const IC_GEAR = _svg('<circle cx="12" cy="12" r="2.6"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.6h.1A1.6 1.6 0 0 0 8.6 1V.9a2 2 0 0 1 4 0V1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>');

  const P = document.createElement("div");
  P.id = "fp-panel";
  P.innerHTML =
    '<div id="fp-hd"><img src="' + chrome.runtime.getURL("icon32.png") + '" width="18" height="18" style="border-radius:5px"><b>Fusion Etsy Puller</b><button class="fp-btn" id="fp-min" title="Minimize">–</button></div>' +
    '<div id="fp-bd">' +
    '<div id="fp-cnt">Captured: 0 orders</div>' +
    '<button class="act fp-sync" id="fp-sync"' + IC_PUSH + 'Push to FUSION</button>' +
        '<button class="fp-cfgtoggle" id="fp-cfgtoggle"' + IC_GEAR + 'Configure URL / token ▾</button>' +
    '<div id="fp-cfg">' +
      '<label>Ingest URL</label><input id="fp-url" name="fp-url-nofill" autocomplete="off" data-lpignore="true" data-1p-ignore data-form-type="other" readonly placeholder="https://os.fusiondn.com/api/ingest/etsy">' +
      '<label>Store token</label><input id="fp-token" type="password" name="fp-token-nofill" autocomplete="new-password" data-lpignore="true" data-1p-ignore data-form-type="other" readonly placeholder="Etsy store token from FUSION">' +
      '<label style="display:flex;align-items:center;gap:6px;font-weight:600;margin-top:10px"><input type="checkbox" id="fp-autofill" style="width:auto"> Auto-fill carrier + tracking on Etsy</label>' +
      '<div class="r"><button class="fp-save" id="fp-save">Save config</button></div>' +
    '</div>' +
    '<div id="fp-track"></div>' +
    '<div id="fp-msg"></div>' +
    '</div>';
  const PILL = document.createElement("div");
  PILL.id = "fp-pill";
  PILL.innerHTML = '<img src="' + chrome.runtime.getURL("icon32.png") + '" width="16" height="16"><span id="fp-pillcnt">0</span> orders';

  const mount = () => { if (document.body) { document.body.appendChild(P); document.body.appendChild(PILL); init(); } else setTimeout(mount, 200); };
  mount();

  function msg(t, ok) { const m = P.querySelector("#fp-msg"); m.style.display = "block"; m.textContent = t; m.style.background = ok ? "#E7F6EC" : "#FDECEC"; m.style.color = ok ? "#15803d" : "#D14343"; }
  function refresh() {
    try { chrome.runtime.sendMessage({ type: "count" }, (r) => { if (!r) return; const n = r.count; const c = P.querySelector("#fp-cnt"); if (c) c.textContent = `Captured: ${n} orders`; const pc = PILL.querySelector("#fp-pillcnt"); if (pc) pc.textContent = n; }); } catch (_) {}
  }

  // ==== Overlay trạng thái + tracking từ FUSION lên trang Etsy ====
  var STATUS = {};
  var AUTOFILL = true;

  // Đặt value theo kiểu React nhận diện được (native setter + dispatch event)
  function setNativeValue(el, value) {
    try {
      var proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : (el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype);
      var setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, value);
    } catch (_) { el.value = value; }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function carrierKey(s) {
    s = (s || "").toLowerCase();
    if (/usps|united states postal/.test(s)) return "usps";
    if (/fedex/.test(s)) return "fedex";
    if (/\bups\b/.test(s)) return "ups";
    if (/dhl/.test(s)) return "dhl";
    if (/royal.?mail/.test(s)) return "royal";
    if (/canada.?post/.test(s)) return "canada";
    if (/australia|auspost/.test(s)) return "australia";
    if (/yun.?express|yunexpress/.test(s)) return "yun";
    if (/4px/.test(s)) return "4px";
    if (/china.?post/.test(s)) return "china";
    return "";
  }
  function carrierIsCarrierSelect(sel) {
    var opts = sel.options, cnt = 0;
    for (var j = 0; j < opts.length; j++) if (carrierKey(opts[j].textContent)) cnt++;
    return cnt >= 2;
  }
  function elDist(a, b) {
    try { var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return Math.abs(ra.top - rb.top) + Math.abs(ra.left - rb.left); } catch (_) { return 1e9; }
  }
  function fillCarrier(near, carrier) {
    var key = carrierKey(carrier); if (!key) return false;
    // 1) Native <select> giống carrier (Etsy Wt-Select thường là select thật) — quét toàn trang, ưu tiên gần ô tracking
    var all = document.querySelectorAll("select"), cands = [];
    for (var i = 0; i < all.length; i++) if (carrierIsCarrierSelect(all[i])) cands.push(all[i]);
    cands.sort(function (a, b) { return elDist(a, near) - elDist(b, near); });
    for (var c = 0; c < cands.length; c++) {
      var sel = cands[c], opts = sel.options;
      for (var j = 0; j < opts.length; j++) {
        if (carrierKey(opts[j].textContent) === key) { setNativeValue(sel, opts[j].value); return true; }
      }
    }
    // 2) Dropdown tùy biến: tìm control gần label "carrier", click mở rồi chọn option khớp
    var combo = findCarrierCombo(near);
    if (combo) { openAndPickCarrier(combo, key); return true; }
    return false;
  }
  function findCarrierCombo(near) {
    // tìm phần tử text "Shipping carrier" rồi lấy control clickable gần nhất trong cùng cụm
    var nodes = document.querySelectorAll("label,span,div,legend,p");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i]; if (el.children.length) continue;
      var tx = (el.textContent || "").trim().toLowerCase();
      if (tx.indexOf("shipping carrier") === 0 || tx === "carrier") {
        var box = el;
        for (var up = 0; up < 6 && box; up++) {
          var ctrl = box.querySelector('[role="combobox"],[role="listbox"],[aria-haspopup],button,[role="button"],input[readonly]');
          if (ctrl && ctrl.tagName !== "SELECT") return ctrl;
          box = box.parentElement;
        }
      }
    }
    return null;
  }
  function openAndPickCarrier(combo, key) {
    try { combo.click(); combo.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); } catch (_) {}
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      var opts = document.querySelectorAll('[role="option"],[role="menuitem"],li,[data-value]');
      for (var i = 0; i < opts.length; i++) {
        var o = opts[i];
        var tx = (o.textContent || "").trim();
        if (tx && tx.length < 30 && carrierKey(tx) === key) {
          try { o.click(); o.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); o.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); } catch (_) {}
          clearInterval(iv); return;
        }
      }
      if (tries > 12) clearInterval(iv);
    }, 120);
  }
    function orderIdNear(el) {
    var node = el;
    for (var i = 0; i < 8 && node; i++) {
      var m = (node.textContent || "").match(/#?(\d{8,13})/);
      if (m && STATUS[m[1]] && STATUS[m[1]].hasTracking) return m[1];
      node = node.parentElement;
    }
    var ready = Object.keys(STATUS).filter(function (id) { return STATUS[id].hasTracking; });
    if (ready.length === 1) return ready[0]; // trên trang chỉ có 1 đơn có tracking → chắc chắn là nó
    return null;
  }
  function tryFillTrackingForm() {
    if (!AUTOFILL) return;
    var inputs = document.querySelectorAll("input,textarea");
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      var meta = ((inp.placeholder || "") + " " + (inp.name || "") + " " + (inp.getAttribute("aria-label") || "") + " " + (inp.id || "")).toLowerCase();
      if (!/track/.test(meta)) continue;
      if (/url|link/.test(meta)) continue;
      if (inp.getAttribute("data-fp-filled")) continue;
      if (inp.value && inp.value.trim()) continue; // user đã gõ → không đè
      var id = orderIdNear(inp); if (!id) continue;
      var st = STATUS[id]; if (!st || !st.hasTracking) continue;
      setNativeValue(inp, st.tracking);
      inp.setAttribute("data-fp-filled", id);
      fillCarrier(inp, st.carrier);
      try { msg("Auto-filled tracking for #" + id + " \u2014 review & Complete on Etsy.", true); } catch (_) {}
    }
  }
  function scanDomIds() {
    var ids = new Set();
    var els = document.querySelectorAll("a,span,h1,h2,h3,p,div");
    for (var i = 0; i < els.length; i++) {
      var el = els[i]; if (el.children.length) continue;
      var tx = (el.textContent || "").trim();
      var m = tx.match(/#?(\d{8,13})/);
      if (m) ids.add(m[1]);
    }
    return Array.from(ids).slice(0, 300);
  }
  function loadStatus() {
    try {
      chrome.runtime.sendMessage({ type: "status", ids: scanDomIds() }, function (r) {
        if (!r || !r.ok) return;
        STATUS = r.orders || {};
        renderBadges(); renderTrackList();
      });
    } catch (_) {}
  }
  function badgeStyle(st) {
    if (st.pushedToEtsy) return { t: "On Etsy \u2713", bg: "#E7F6EC", fg: "#15803d" };
    if (st.hasTracking) return { t: "Tracking ready", bg: "#FFF4E5", fg: "#B45309" };
    var map = { new: "New", created: "Created", in_production: "In production", shipped: "Shipped", completed: "Completed", has_issues: "Issue", trash: "Trash" };
    return { t: (map[st.status] || st.status), bg: "#EEF2F7", fg: "#5A6272" };
  }
  function findOrderEl(id) {
    var els = document.querySelectorAll("a,span,h1,h2,h3,p");
    for (var i = 0; i < els.length; i++) { var el = els[i]; if (el.children.length) continue; var tx = (el.textContent || "").trim(); if (tx === "#" + id || tx === id || tx === "Order #" + id) return el; }
    for (var j = 0; j < els.length; j++) { var e2 = els[j]; if (e2.children.length) continue; var t2 = (e2.textContent || "").trim(); if (t2.length < 40 && t2.indexOf(id) !== -1) return e2; }
    return null;
  }
  function renderBadges() {
    Object.keys(STATUS).forEach(function (id) {
      var st = STATUS[id];
      var el = findOrderEl(id); if (!el) return;
      if (el.parentNode && el.parentNode.querySelector('[data-fp="' + id + '"]')) return;
      var b = badgeStyle(st);
      var span = document.createElement("span");
      var ready = st.hasTracking && !st.pushedToEtsy;
      span.className = "fp-badge" + (ready ? " copy" : "");
      span.setAttribute("data-fp", id);
      span.style.background = b.bg; span.style.color = b.fg;
      span.textContent = b.t + (ready ? (" \u00b7 " + ((st.carrier || "") + " " + st.tracking).trim()) : "");
      if (ready) { span.title = "Click to copy tracking"; span.onclick = function () { try { navigator.clipboard.writeText(st.tracking); span.textContent = "Copied \u2713"; setTimeout(function(){ renderBadges(); }, 1000); } catch (_) {} }; }
      el.insertAdjacentElement("afterend", span);
    });
  }
  function renderTrackList() {
    var box = P.querySelector("#fp-track"); if (!box) return;
    var need = Object.keys(STATUS).filter(function (id) { return STATUS[id].hasTracking && !STATUS[id].pushedToEtsy; });
    if (!need.length) { box.innerHTML = ""; return; }
    var html = '<div class="h">Tracking to add on Etsy (' + need.length + ')</div>';
    need.forEach(function (id) {
      var st = STATUS[id];
      html += '<div class="row"><span class="id">#' + id + '</span><span class="tk">' + ((st.carrier || "") + " " + st.tracking).trim() + '</span><button data-cp="' + id + '">Copy</button></div>';
    });
    box.innerHTML = html;
    box.querySelectorAll("button[data-cp]").forEach(function (btn) {
      btn.onclick = function () { var id = btn.getAttribute("data-cp"); try { navigator.clipboard.writeText(STATUS[id].tracking); } catch (_) {} btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy"; }, 1200); };
    });
  }

  function init() {
    // load saved config
    chrome.storage.local.get("fp_cfg", (o) => {
      const c = o.fp_cfg || {};
      let url = c.url || "";
      // Mặc định domain mới; tự chuyển các cấu hình cũ trỏ vercel sang os.fusiondn.com
      if (!url || url.indexOf("fusionos-sigma.vercel.app") !== -1) {
        url = DEFAULT_INGEST;
        if (url !== c.url) chrome.storage.local.set({ fp_cfg: { url: url, token: c.token || "", autofill: c.autofill !== false } });
      }
      P.querySelector("#fp-url").value = url;
      P.querySelector("#fp-token").value = c.token || "";
      AUTOFILL = c.autofill !== false; const af = P.querySelector("#fp-autofill"); if (af) af.checked = AUTOFILL;
      if (!url || !c.token) P.querySelector("#fp-cfg").style.display = "block";
    });
    { const af = P.querySelector("#fp-autofill"); if (af) af.onchange = () => { AUTOFILL = af.checked; }; }

    P.querySelector("#fp-sync").onclick = () => {
      msg("Pushing…", true);
      chrome.runtime.sendMessage({ type: "sync" }, (r) => {
        if (!r) return msg("No response.", false);
        if (r.ok) { msg(`✓ Received ${r.received} — created ${r.created}, skipped ${r.skipped}`, true); refresh(); }
        else msg("✗ " + r.error, false);
      });
    };
    // Chặn Chrome autofill: field readonly lúc tải, bỏ readonly khi người dùng focus để gõ
    ["#fp-url", "#fp-token"].forEach((sel) => { const el = P.querySelector(sel); if (el) { el.addEventListener("focus", () => el.removeAttribute("readonly")); el.addEventListener("blur", () => { if (!el.value) el.setAttribute("readonly", ""); }); } });

    P.querySelector("#fp-cfgtoggle").onclick = () => { const c = P.querySelector("#fp-cfg"); c.style.display = c.style.display === "block" ? "none" : "block"; };
    P.querySelector("#fp-save").onclick = () => { AUTOFILL = P.querySelector("#fp-autofill").checked; chrome.storage.local.set({ fp_cfg: { url: P.querySelector("#fp-url").value.trim(), token: P.querySelector("#fp-token").value.trim(), autofill: AUTOFILL } }, () => msg("✓ Config saved.", true)); };
    P.querySelector("#fp-min").onclick = () => { P.style.display = "none"; PILL.style.display = "flex"; };
    PILL.onclick = () => { PILL.style.display = "none"; P.style.display = "block"; };

    // Drag to move via the header
    (function drag() {
      const hd = P.querySelector("#fp-hd"); let sx, sy, ox, oy, on = false;
      hd.addEventListener("mousedown", (e) => { if (e.target.id === "fp-min") return; on = true; const r = P.getBoundingClientRect(); ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY; e.preventDefault(); });
      window.addEventListener("mousemove", (e) => { if (!on) return; P.style.left = (ox + e.clientX - sx) + "px"; P.style.top = (oy + e.clientY - sy) + "px"; P.style.right = "auto"; P.style.bottom = "auto"; });
      window.addEventListener("mouseup", () => { on = false; });
    })();

    refresh(); scanEmbedded(); setTimeout(refresh, 600);
    chrome.runtime.onMessage.addListener((m) => { if (m && m.type === "count-changed") { refresh(); loadStatus(); } });

    // Overlay trạng thái/tracking lên trang Etsy: nạp lần đầu + định kỳ + khi DOM đổi (Etsy là SPA)
    setTimeout(loadStatus, 1500);
    setInterval(loadStatus, 20000);
    setInterval(tryFillTrackingForm, 2500);
    var dbc = null;
    try { new MutationObserver(function () { clearTimeout(dbc); dbc = setTimeout(function () { renderBadges(); tryFillTrackingForm(); }, 700); }).observe(document.body, { childList: true, subtree: true }); } catch (_) {}
  }
})();
