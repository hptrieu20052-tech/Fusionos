/*
 * background.js — bộ não Fusion Etsy Puller (tái thiết v1.1.0).
 * Nhận JSON Etsy thô từ content.js ("etsy-data") → bóc receipt → buffer (dedupe theo receipt id)
 * → "sync" đẩy lên FUSION (POST {orders} + Bearer store token) → "status" tra trạng thái/tracking
 * cho overlay. Kèm check bản mới từ server FUSION (badge NEW).
 */

const UPDATE_BASE = "https://os.fusiondn.com";

// ===== Buffer đơn đã bắt (RAM + backup storage.local vì service worker hay ngủ) =====
let BUF = new Map(); // externalId -> InOrder
let bufLoaded = false;
async function loadBuf() {
  if (bufLoaded) return;
  bufLoaded = true;
  try {
    const { fp_buf } = await chrome.storage.local.get("fp_buf");
    if (Array.isArray(fp_buf)) for (const o of fp_buf) if (o && o.externalId) BUF.set(o.externalId, o);
  } catch (_) {}
}
function saveBuf() {
  try { chrome.storage.local.set({ fp_buf: Array.from(BUF.values()).slice(0, 500) }); } catch (_) {}
}
function broadcastCount() {
  updateBadge();
  chrome.tabs.query({ url: "https://www.etsy.com/*" }, (tabs) => {
    for (const t of tabs) { try { chrome.tabs.sendMessage(t.id, { type: "count-changed" }); } catch (_) {} }
  });
}

// ===== Tiền: {amount,divisor} | "US$1,234.56" | number =====
function money(v) {
  if (v == null) return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  if (typeof v === "string") { const n = Number(v.replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; }
  if (typeof v === "object") {
    if (v.amount != null && v.divisor) return Number(v.amount) / Number(v.divisor);
    if (v.amount != null) return money(v.amount);
    if (v.value != null) return money(v.value);
    if (v.formatted != null) return money(v.formatted);
  }
  return 0;
}
const S = (v) => (typeof v === "string" && v.trim() ? v.trim() : (typeof v === "number" ? String(v) : ""));
const pick = (o, ...keys) => { for (const k of keys) { const v = S(o && o[k]); if (v) return v; } return ""; };

// ===== Nhận diện + bóc receipt (khớp InOrder của /api/ingest/etsy) =====
function looksLikeReceipt(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  const id = o.receipt_id ?? o.receiptId ?? o.order_id ?? o.orderId;
  if (id == null || !/^\d{6,15}$/.test(String(id))) return false;
  return !!(o.transactions || o.line_items || o.first_line || o.address_first_line || o.name || o.buyer ||
    o.grandtotal || o.grand_total || o.formatted_grandtotal || o.total_price ||
    o.shipping_address || o.to_address || o.payment);
}
function extractItems(o) {
  const txs = Array.isArray(o.transactions) ? o.transactions : (Array.isArray(o.line_items) ? o.line_items : []);
  const items = [];
  for (const t of txs) {
    if (!t || typeof t !== "object") continue;
    const L = (t.listing && typeof t.listing === "object") ? t.listing : {};
    const priceInt = (t.price_int != null && !isNaN(Number(t.price_int))) ? Number(t.price_int) / 100 : 0;
    const it = {
      title: pick(t, "title", "listing_title", "product_title", "product_name", "name")
        || pick(L, "title", "name") || "Etsy item",
      qty: Number(t.quantity ?? t.qty ?? 1) || 1,
      price: money(t.price ?? t.unit_price ?? t.subtotal ?? t.total) || priceInt,
      sku: pick(t, "sku", "product_sku") || undefined,
      listingId: S(t.listing_id ?? t.listingId ?? L.listing_id ?? L.id) || undefined,
    };
    const vars = Array.isArray(t.variations) ? t.variations : [];
    const vparts = [], pparts = [];
    for (const v of vars) {
      const n = pick(v, "formatted_name", "property_name", "name");
      const val = pick(v, "formatted_value", "value");
      if (!n && !val) continue;
      if (/personal/i.test(n)) pparts.push(val || n);
      else vparts.push(n && val ? `${n}: ${val}` : (val || n));
    }
    if (vparts.length) it.variant = vparts.join(" · ").slice(0, 300);
    const pz = pparts.join(" · ") || S(t.personalization ?? t.buyer_personalization);
    if (pz) it.personalization = pz.slice(0, 800);
    const img = t.image || t.img || (t.product && t.product.image) || {};
    const iurl = pick(img, "url_170x135", "url_75x75", "url", "src") || S(t.image_url);
    if (iurl) it.imageUrl = iurl;
    items.push(it);
  }
  return items;
}
function firstObj(o) {
  for (var i = 1; i < arguments.length; i++) {
    var v = o && o[arguments[i]];
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  }
  return null;
}
function extractReceipt(o) {
  const id = String(o.receipt_id ?? o.receiptId ?? o.order_id ?? o.orderId);
  // Địa chỉ/buyer/total có thể nằm ở gốc HOẶC lồng trong object con
  const A = firstObj(o, "shipping_address", "to_address", "shipment_address", "address", "shipping_details") || {};
  const B = firstObj(o, "buyer", "buyer_user", "customer") || {};
  const P = firstObj(o, "payment", "totals", "pricing") || {};
  const pick2 = (k1, k2) => pick(o, ...k1) || pick(A, ...k2 || k1) || "";
  const fullName = pick(o, "name", "buyer_name", "recipient_name", "to_name")
    || pick(A, "name", "to_name", "recipient_name", "full_name")
    || pick(B, "name", "display_name", "full_name", "login_name");
  const sp = fullName.split(/\s+/);
  const order = {
    externalId: id,
    buyerFirst: sp.slice(0, -1).join(" ") || sp[0] || undefined,
    buyerLast: sp.length > 1 ? sp[sp.length - 1] : undefined,
    addr1: pick2(["first_line", "address_first_line", "line1", "street1"]) || undefined,
    addr2: pick2(["second_line", "address_second_line", "line2", "street2"]) || undefined,
    city: pick2(["city", "address_city"]) || undefined,
    state: pick2(["state", "address_state", "region", "province"]) || undefined,
    zip: pick2(["zip", "address_zip", "postal_code", "zip_code"]) || undefined,
    country: pick2(["country_name", "address_country_name", "country", "country_iso"]) || undefined,
    total: money(o.grandtotal ?? o.grand_total ?? o.formatted_grandtotal ?? o.total_price ?? o.total
      ?? P.grand_total ?? P.grandtotal ?? P.total ?? P.total_price) || undefined,
    note: pick(o, "message_from_buyer", "buyer_message", "note_from_buyer") || undefined,
    items: extractItems(o),
  };
  if (!order.items.length) order.items = [{ title: "Etsy order " + id, qty: 1 }];
  return order;
}
function harvest(data) {
  let added = 0;
  (function walk(node, depth) {
    if (!node || depth > 9) return;
    if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1); return; }
    if (typeof node !== "object") return;
    if (looksLikeReceipt(node)) {
      saveDebugPaths(node);
      const o = extractReceipt(node);
      const prev = BUF.get(o.externalId);
      if (!prev) { BUF.set(o.externalId, o); added++; }
      else if ((o.addr1 && !prev.addr1) || (o.items.length > (prev.items || []).length)) { BUF.set(o.externalId, o); added++; }
    }
    for (const k in node) walk(node[k], depth + 1);
  })(data, 0);
  return added;
}

// ===== Debug: flatten key-paths của 1 receipt node thô (để chỉnh map khi Etsy đổi cấu trúc) =====
let debugSaved = false;
function saveDebugPaths(node) {
  if (debugSaved) return;
  debugSaved = true;
  try {
    const lines = [], seen = new Set();
    (function walk(n, path, d) {
      if (d > 6 || n == null || lines.length > 150) return;
      if (Array.isArray(n)) { if (n.length) walk(n[0], path + "[]", d + 1); return; }
      if (typeof n === "object") { for (const k in n) walk(n[k], path ? path + "." + k : k, d + 1); return; }
      if (seen.has(path)) return; seen.add(path);
      const KW = /(^|[._[])(order_id|receipt_id|id)($|[._[])|name|address|first_line|second_line|line1|line2|city|state|province|region|zip|postal|country|title|product|listing|price|amount|divisor|total|subtotal|quantity|qty|image|img|photo|thumb|url|personal|variation|variant|sku|buyer|recipient|ship|formatted|payment|grand/i;
      if (!KW.test(path)) return;
      const val = (typeof n === "number" || typeof n === "boolean") ? n : "str";
      lines.push(path + " = " + val);
    })(node, "", 0);
    chrome.storage.local.set({ fp_lastpaths: "# ETSY RECEIPT FIELD MAP (send to dev)\n" + lines.join("\n") });
  } catch (_) {}
}

// ===== Badge: ưu tiên NEW (update) > số đơn buffer =====
async function updateBadge() {
  const { updateAvailable } = await chrome.storage.local.get("updateAvailable");
  if (updateAvailable) {
    chrome.action.setBadgeText({ text: "NEW" });
    chrome.action.setBadgeBackgroundColor({ color: "#D93025" });
    return;
  }
  const n = BUF.size;
  chrome.action.setBadgeText({ text: n > 0 ? String(n) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#0D4C9B" });
}

// ===== Message hub =====
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    await loadBuf();
    if (msg && msg.type === "etsy-data") {
      const n = harvest(msg.data);
      if (n > 0) { saveBuf(); broadcastCount(); }
      sendResponse({ ok: true, added: n, count: BUF.size });
      return;
    }
    if (msg && msg.type === "count") { sendResponse({ count: BUF.size }); return; }
    if (msg && msg.type === "clear") { BUF.clear(); saveBuf(); broadcastCount(); sendResponse({ ok: true }); return; }
    if (msg && msg.type === "sync") {
      const { fp_cfg } = await chrome.storage.local.get("fp_cfg");
      const cfg = fp_cfg || {};
      if (!cfg.url || !cfg.token) { sendResponse({ ok: false, error: "Configure Ingest URL + Store token first (Configure)." }); return; }
      const orders = Array.from(BUF.values());
      if (!orders.length) { sendResponse({ ok: false, error: "No captured orders — scroll the Etsy Orders page first." }); return; }
      try {
        const r = await fetch(cfg.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.token },
          body: JSON.stringify({ orders }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.ok) { BUF.clear(); saveBuf(); broadcastCount(); sendResponse({ ok: true, received: j.received, created: j.created, skipped: j.skipped, errors: j.errors }); }
        else sendResponse({ ok: false, error: j.error || ("HTTP " + r.status) });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
      return;
    }
    if (msg && msg.type === "status") {
      const { fp_cfg } = await chrome.storage.local.get("fp_cfg");
      const cfg = fp_cfg || {};
      if (!cfg.url || !cfg.token) { sendResponse({ ok: false }); return; }
      try {
        const statusUrl = new URL(cfg.url).origin + "/api/ingest/etsy/status";
        const r = await fetch(statusUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.token },
          body: JSON.stringify({ externalIds: msg.ids || [] }),
        });
        sendResponse(await r.json().catch(() => ({ ok: false })));
      } catch (_) { sendResponse({ ok: false }); }
      return;
    }
    sendResponse({ ok: false, error: "unknown message" });
  })();
  return true; // async
});

// ===== Check bản mới từ FUSION (badge NEW — Chrome cấm load-unpacked tự update ngầm) =====
function cmpVer(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
async function checkUpdate() {
  try {
    const r = await fetch(UPDATE_BASE + "/api/extension/version?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    const cur = chrome.runtime.getManifest().version;
    if (j.version && cmpVer(j.version, cur) > 0) {
      await chrome.storage.local.set({ updateAvailable: j.version });
      chrome.action.setTitle({ title: "Fusion Etsy Puller — new version " + j.version + " available (open popup to download)" });
    } else {
      await chrome.storage.local.remove("updateAvailable");
      chrome.action.setTitle({ title: "Fusion Etsy Puller" });
    }
    updateBadge();
  } catch (_) { /* offline thì thôi */ }
}
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create("fusion-update-check", { periodInMinutes: 360 }); checkUpdate(); loadBuf().then(updateBadge); });
chrome.runtime.onStartup.addListener(() => { checkUpdate(); loadBuf().then(updateBadge); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "fusion-update-check") checkUpdate(); });
