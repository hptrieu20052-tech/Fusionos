/**
 * WOOCOMMERCE — kết nối store WooCommerce (WordPress) với FUSION (v496). Khuôn theo ShopBase.
 *
 * Woo REST API chuẩn: {store}/wp-json/wc/v3/{res} · auth Basic (consumer_key:consumer_secret)
 * qua HTTPS. Một số host strip header Authorization → tự fallback sang query param
 * consumer_key/consumer_secret (cách Woo chính thức hỗ trợ).
 *
 * Credentials nằm trong stores.api_credentials.woocommerce = { storeUrl, consumerKey,
 * consumerSecret, lastSyncAt } — cô lập như shopbase/spapi. KHÔNG commit secret vào code.
 */
import { db, schema } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import type { InOrder, InItem } from "@/lib/ingest-etsy";

export type WooCred = { storeUrl?: string; consumerKey?: string; consumerSecret?: string; lastSyncAt?: string };

/** Chuẩn hoá store URL: nhận cả "sorawix.com", "https://sorawix.com/" → "https://sorawix.com". */
export function wooBaseUrl(cred: WooCred): string {
  let u = String(cred.storeUrl ?? "").trim().replace(/\/+$/, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}
export function wooConfigured(cred: WooCred | null | undefined): boolean {
  return !!(cred && wooBaseUrl(cred) && String(cred.consumerKey ?? "").trim() && String(cred.consumerSecret ?? "").trim());
}

/** Gọi Woo REST API. Basic auth trước, 401/403 → thử lại bằng query param (host strip header). */
export async function wooApi(cred: WooCred, path: string, init: RequestInit = {}): Promise<unknown> {
  return (await wooApiFull(cred, path, init)).data;
}

/** v501 · Như wooApi nhưng trả kèm tổng số bản ghi (header X-WP-Total/X-WP-TotalPages) — cho phân trang. */
export async function wooApiFull(cred: WooCred, path: string, init: RequestInit = {}): Promise<{ data: unknown; total: number; totalPages: number }> {
  const base = wooBaseUrl(cred);
  if (!base) throw new Error("WooCommerce store chưa cấu hình Store URL");
  const ck = String(cred.consumerKey ?? "").trim(), cs = String(cred.consumerSecret ?? "").trim();
  if (!ck || !cs) throw new Error("WooCommerce store chưa nhập Consumer key + secret");
  const url = `${base}/wp-json/wc/v3/${path.replace(/^\/+/, "")}`;

  const call = async (u: string, withBasic: boolean) => {
    const res = await fetch(u, {
      ...init,
      headers: {
        ...(withBasic ? { Authorization: `Basic ${Buffer.from(`${ck}:${cs}`).toString("base64")}` } : {}),
        "Content-Type": "application/json", Accept: "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    return { res, text };
  };

  let { res, text } = await call(url, true);
  if (res.status === 401 || res.status === 403) {
    // Host strip Authorization header (Apache/CGI phổ biến) → fallback query param.
    const qs = url.includes("?") ? "&" : "?";
    ({ res, text } = await call(`${url}${qs}consumer_key=${encodeURIComponent(ck)}&consumer_secret=${encodeURIComponent(cs)}`, false));
  }
  if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return {
      data: text ? JSON.parse(text) : {},
      total: Number(res.headers.get("x-wp-total")) || 0,
      totalPages: Number(res.headers.get("x-wp-totalpages")) || 0,
    };
  } catch { throw new Error("WooCommerce: phản hồi không phải JSON — kiểm tra Store URL (đúng site WordPress?)"); }
}

/**
 * v505 · Gọi REST của plugin cầu nối wcp-fusion-bridge trên store (namespace wc-fusion/v1 —
 * bắt đầu bằng "wc-" nên WooCommerce áp key auth y như wc/v3). Dùng cho màn Product Types.
 */
export async function wooBridgeApi(cred: WooCred, path: string, init: RequestInit = {}): Promise<unknown> {
  const base = wooBaseUrl(cred);
  if (!base) throw new Error("WooCommerce store chưa cấu hình Store URL");
  const ck = String(cred.consumerKey ?? "").trim(), cs = String(cred.consumerSecret ?? "").trim();
  if (!ck || !cs) throw new Error("WooCommerce store chưa nhập Consumer key + secret");
  const url = `${base}/wp-json/wc-fusion/v1/${path.replace(/^\/+/, "")}`;
  const call = async (u: string, withBasic: boolean) => {
    const res = await fetch(u, {
      ...init,
      headers: {
        ...(withBasic ? { Authorization: `Basic ${Buffer.from(`${ck}:${cs}`).toString("base64")}` } : {}),
        "Content-Type": "application/json", Accept: "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    return { res, text };
  };
  let { res, text } = await call(url, true);
  if (res.status === 401 || res.status === 403) {
    const qs = url.includes("?") ? "&" : "?";
    ({ res, text } = await call(`${url}${qs}consumer_key=${encodeURIComponent(ck)}&consumer_secret=${encodeURIComponent(cs)}`, false));
  }
  if (res.status === 404) throw new Error("Store chưa cài plugin WCP Fusion Bridge — upload wcp-fusion-bridge.zip trong WP admin → Plugins → Add New rồi Activate.");
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try { const j = JSON.parse(text); if (j?.message) msg = String(j.message); } catch { /* giữ raw */ }
    throw new Error(`Bridge HTTP ${res.status}: ${msg}`);
  }
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new Error("Bridge: phản hồi không phải JSON — kiểm tra Store URL"); }
}

// ── Config helpers (đọc/ghi apiCredentials.woocommerce — mirror pattern shopbase) ───────────────
export async function getWooCred(storeId?: string): Promise<{ storeId: string; cred: WooCred } | null> {
  const rows = await db.select({ id: schema.stores.id, cred: schema.stores.apiCredentials }).from(schema.stores)
    .where(storeId ? eq(schema.stores.id, storeId) : eq(schema.stores.marketplace, "woocommerce" as never))
    .orderBy(desc(schema.stores.createdAt)).limit(1);
  const row = rows[0];
  if (!row) return null;
  const wc = (((row.cred ?? {}) as Record<string, unknown>).woocommerce ?? {}) as WooCred;
  return { storeId: row.id, cred: wc };
}
/** Merge field vào api_credentials.woocommerce. undefined = giữ nguyên. */
export async function mergeWooCred(storeId: string, patch: Partial<WooCred>): Promise<void> {
  const [row] = await db.select({ cred: schema.stores.apiCredentials }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  const cred = { ...((row?.cred ?? {}) as Record<string, unknown>) };
  const wc = { ...((cred.woocommerce ?? {}) as WooCred) } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) continue; wc[k] = v; }
  cred.woocommerce = wc;
  await db.update(schema.stores).set({ apiCredentials: cred }).where(eq(schema.stores.id, storeId));
}
export async function touchWooSync(storeId: string): Promise<void> {
  await mergeWooCred(storeId, { lastSyncAt: new Date().toISOString() }).catch(() => {});
}

// ── Chuẩn hoá đơn Woo → InOrder cho insertEtsyOrders ────────────────────────────────────────────
const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const strv = (v: unknown) => (v == null ? "" : String(v)).trim();

/** meta_data của line item → personalization text + file khách upload (đơn photo/name custom). */
function splitMeta(meta: unknown): { personalization: string; files: { name: string; url: string }[] } {
  const arr = Array.isArray(meta) ? (meta as Record<string, unknown>[]) : [];
  const parts: string[] = []; const files: { name: string; url: string }[] = [];
  for (const m of arr) {
    const key = strv(m.display_key) || strv(m.key);
    let value = strv(m.display_value) || strv(m.value);
    if (!key || key.startsWith("_") || !value) continue;
    value = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); // display_value có thể là HTML
    if (!value) continue;
    const urls = value.match(/https?:\/\/\S+\.(?:jpe?g|png|webp|heic|pdf)\S*/gi) ?? [];
    for (const u of urls) files.push({ name: key, url: u });
    parts.push(`${key}: ${value}`);
  }
  return { personalization: parts.join("\n"), files };
}

export function normalizeWooOrder(o: Record<string, unknown>): InOrder {
  const ship0 = (o.shipping ?? {}) as Record<string, unknown>;
  const bill = (o.billing ?? {}) as Record<string, unknown>;
  // Đơn digital / thiếu shipping → fallback billing.
  const ship = strv(ship0.address_1) ? ship0 : bill;
  const items = (Array.isArray(o.line_items) ? o.line_items : []) as Record<string, unknown>[];
  const mapped: InItem[] = items.map((li) => {
    const { personalization, files } = splitMeta(li.meta_data);
    const qty = num(li.quantity) || 1;
    return {
      title: strv(li.name) || "WooCommerce item",
      sku: strv(li.sku) || undefined,
      qty,
      price: num(li.price) || (num(li.total) > 0 ? num(li.total) / qty : 0),
      variant: undefined, // Woo nhét variation vào meta_data (Size/Color) → đã gom vào personalization
      personalization: personalization || undefined,
      listingId: strv(li.product_id) || undefined,
      files: files.length ? files : undefined,
    };
  });
  const shipLines = (Array.isArray(o.shipping_lines) ? o.shipping_lines : []) as Record<string, unknown>[];
  return {
    externalId: strv(o.id) || strv(o.number),
    shippingMethod: strv(shipLines[0]?.method_title) || undefined,
    buyerFirst: strv(ship.first_name) || strv(bill.first_name) || undefined,
    buyerLast: strv(ship.last_name) || strv(bill.last_name) || undefined,
    addr1: strv(ship.address_1) || undefined,
    addr2: strv(ship.address_2) || undefined,
    city: strv(ship.city) || undefined,
    state: strv(ship.state) || undefined,
    zip: strv(ship.postcode) || undefined,
    country: strv(ship.country) || "United States",
    total: num(o.total),
    note: strv(o.customer_note) || undefined,
    platformStatus: strv(o.status) || undefined, // pending/processing/on-hold/completed/cancelled/refunded…
    items: mapped,
  };
}

// Trạng thái KHÔNG kéo về: chưa trả tiền / huỷ / hoàn / rác / draft.
const SKIP_STATUS = /^(pending|failed|cancelled|refunded|trash|checkout-draft|auto-draft)$/i;

/**
 * Kéo đơn Woo qua REST (paginate page=1..n, orderby date asc). after (ISO) = chỉ lấy đơn
 * tạo sau mốc này (sync tăng dần). Trần trang để tránh chạy vô tận.
 */
export async function fetchWooOrders(cred: WooCred, opts: { after?: string; maxPages?: number } = {}): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const maxPages = Math.min(Math.max(opts.maxPages ?? 20, 1), 50);
  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({ per_page: "100", page: String(page), order: "asc", orderby: "date", status: "any" });
    if (opts.after) qs.set("after", opts.after);
    const j = await wooApi(cred, `orders?${qs}`);
    const batch = (Array.isArray(j) ? j : []) as Record<string, unknown>[];
    if (!batch.length) break;
    for (const o of batch) {
      if (SKIP_STATUS.test(strv(o.status))) continue;
      out.push(o);
    }
    if (batch.length < 100) break; // trang cuối
  }
  return out;
}
