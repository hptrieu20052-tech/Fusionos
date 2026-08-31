/**
 * SHOPBASE — kết nối store ShopBase với FUSION (v373). ĐỘC LẬP hoàn toàn với Shopify.
 *
 * ShopBase Admin REST API là bản clone của Shopify: base URL {store}.onshopbase.com/admin/{res}.json,
 * shape order gần như y hệt (line_items, shipping_address, landing_site…). Nhưng auth KHÁC:
 *   Private app → Basic Auth (apiKey:password), KHÔNG phải X-Shopify-Access-Token.
 *
 * Credentials nằm trong stores.api_credentials.shopbase = { subdomain, apiKey, password, lastSyncAt }
 * (nested như Amazon spapi — cô lập, không đụng key Shopify). KHÔNG commit secret vào code.
 */
import { db, schema } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import type { InOrder, InItem } from "@/lib/ingest-etsy";

export type ShopBaseCred = { subdomain?: string; apiKey?: string; password?: string; lastSyncAt?: string };

/** {subdomain}.onshopbase.com — chấp nhận người dùng dán cả full domain hoặc chỉ subdomain. */
export function shopbaseHost(cred: ShopBaseCred): string {
  let h = String(cred.subdomain ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
  if (!h) return "";
  if (!h.includes(".")) h = `${h}.onshopbase.com`;   // nhập "johns-apparel" → johns-apparel.onshopbase.com
  return h;
}
export function shopbaseConfigured(cred: ShopBaseCred | null): boolean {
  return !!(cred && shopbaseHost(cred) && String(cred.apiKey ?? "").trim() && String(cred.password ?? "").trim());
}

/** Gọi ShopBase Admin REST API. Basic auth (apiKey:password). Trả JSON, ném lỗi có nội dung để log. */
export async function shopbaseApi(cred: ShopBaseCred, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const host = shopbaseHost(cred);
  if (!host) throw new Error("ShopBase store chưa cấu hình subdomain");
  const apiKey = String(cred.apiKey ?? "").trim(), password = String(cred.password ?? "").trim();
  if (!apiKey || !password) throw new Error("ShopBase store chưa nhập API key + password");
  const auth = Buffer.from(`${apiKey}:${password}`).toString("base64");
  const res = await fetch(`https://${host}/admin/${path.replace(/^\/+/, "")}`, {
    ...init,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ShopBase HTTP ${res.status}: ${text.slice(0, 300)}`);
  try { return text ? JSON.parse(text) : {}; } catch { throw new Error("ShopBase: phản hồi không phải JSON"); }
}

// ── Config helpers (đọc/ghi apiCredentials.shopbase — mirror pattern Amazon spapi) ──────────────
/** id store ShopBase (marketplace='shopbase'). storeId chỉ định thì lấy đúng store đó. */
export async function getShopBaseStoreId(storeId?: string): Promise<string | null> {
  const rows = await db.select({ id: schema.stores.id }).from(schema.stores)
    .where(storeId ? eq(schema.stores.id, storeId) : eq(schema.stores.marketplace, "shopbase" as never))
    .orderBy(desc(schema.stores.createdAt)).limit(1);
  return rows[0]?.id ?? null;
}
export async function getShopBaseCred(storeId?: string): Promise<{ storeId: string; cred: ShopBaseCred } | null> {
  const rows = await db.select({ id: schema.stores.id, cred: schema.stores.apiCredentials }).from(schema.stores)
    .where(storeId ? eq(schema.stores.id, storeId) : eq(schema.stores.marketplace, "shopbase" as never))
    .orderBy(desc(schema.stores.createdAt)).limit(1);
  const row = rows[0];
  if (!row) return null;
  const sb = (((row.cred ?? {}) as Record<string, unknown>).shopbase ?? {}) as ShopBaseCred;
  return { storeId: row.id, cred: sb };
}
/** Merge field vào api_credentials.shopbase. undefined = giữ nguyên. */
export async function mergeShopBaseCred(storeId: string, patch: Partial<ShopBaseCred>): Promise<void> {
  const [row] = await db.select({ cred: schema.stores.apiCredentials }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  const cred = { ...((row?.cred ?? {}) as Record<string, unknown>) };
  const sb = { ...((cred.shopbase ?? {}) as ShopBaseCred) } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) continue; sb[k] = v; }
  cred.shopbase = sb;
  await db.update(schema.stores).set({ apiCredentials: cred }).where(eq(schema.stores.id, storeId));
}
export async function touchShopBaseSync(storeId: string): Promise<void> {
  await mergeShopBaseCred(storeId, { lastSyncAt: new Date().toISOString() }).catch(() => {});
}

// ── Chuẩn hoá đơn (ShopBase order JSON ≈ Shopify) → InOrder cho insertEtsyOrders ────────────────
const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const strv = (v: unknown) => (v == null ? "" : String(v)).trim();

function parseUtm(landing: string): { source?: string; medium?: string; campaign?: string } {
  if (!landing || !landing.includes("?")) return {};
  try {
    const p = new URLSearchParams(landing.slice(landing.indexOf("?") + 1));
    const g = (k: string) => { const v = (p.get(k) ?? "").trim().slice(0, 120); return v || undefined; };
    return { source: g("utm_source"), medium: g("utm_medium"), campaign: g("utm_campaign") };
  } catch { return {}; }
}
function splitProperties(props: unknown): { personalization: string; files: { name: string; url: string }[] } {
  const arr = Array.isArray(props) ? (props as { name?: unknown; value?: unknown }[]) : [];
  const parts: string[] = []; const files: { name: string; url: string }[] = [];
  for (const p of arr) {
    const name = strv(p?.name); const value = strv(p?.value);
    if (!name || !value || name.startsWith("_")) {
      if (/^https?:\/\/\S+\.(jpe?g|png|webp|heic|pdf)/i.test(value)) files.push({ name: name || "upload", url: value });
      continue;
    }
    if (/^https?:\/\/\S+/i.test(value)) { files.push({ name, url: value }); parts.push(`${name}: ${value}`); }
    else parts.push(`${name}: ${value}`);
  }
  return { personalization: parts.join("\n"), files };
}

export function normalizeShopBaseOrder(o: Record<string, unknown>): InOrder {
  const ship = (o.shipping_address ?? o.customer ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(o.line_items) ? o.line_items : []) as Record<string, unknown>[];
  const mapped: InItem[] = items.map((li) => {
    const { personalization, files } = splitProperties(li.properties);
    return {
      title: strv(li.title) || strv(li.name) || "ShopBase item",
      sku: strv(li.sku) || undefined,
      qty: num(li.quantity) || 1,
      price: num(li.price),
      variant: strv(li.variant_title) || undefined,
      personalization: personalization || undefined,
      listingId: strv(li.product_id) || undefined,
      files: files.length ? files : undefined,
    };
  });
  const fullName = strv(ship.name) || `${strv(ship.first_name)} ${strv(ship.last_name)}`.trim();
  const sp = fullName.split(/\s+/);
  const shipLines = (Array.isArray(o.shipping_lines) ? o.shipping_lines : []) as Record<string, unknown>[];
  const shippingMethod = strv(shipLines[0]?.title) || strv(shipLines[0]?.code) || undefined;
  const utm = parseUtm(strv(o.landing_site) || strv(o.landing_site_ref) || strv(o.referring_site) || "");
  return {
    externalId: strv(o.id) || strv(o.name) || strv(o.order_number),
    shippingMethod,
    utmSource: utm.source,
    utmMedium: utm.medium,
    utmCampaign: utm.campaign,
    buyerFirst: strv(ship.first_name) || sp.slice(0, -1).join(" ") || sp[0] || undefined,
    buyerLast: strv(ship.last_name) || (sp.length > 1 ? sp[sp.length - 1] : undefined),
    addr1: strv(ship.address1) || undefined,
    addr2: strv(ship.address2) || undefined,
    city: strv(ship.city) || undefined,
    state: strv(ship.province) || strv(ship.province_code) || undefined,
    zip: strv(ship.zip) || undefined,
    country: strv(ship.country) || strv(ship.country_code) || "United States",
    total: num(o.total_price) || num(o.current_total_price),
    note: strv(o.note) || undefined,
    platformStatus: strv(o.financial_status) || strv(o.fulfillment_status) || undefined,
    items: mapped,
  };
}

/**
 * Kéo đơn ShopBase qua REST (paginate bằng since_id kiểu Shopify legacy — ShopBase hỗ trợ).
 * createdMin (ISO) = chỉ lấy đơn tạo sau mốc này (sync tăng dần). Trần trang để tránh chạy vô tận.
 */
export async function fetchShopBaseOrders(cred: ShopBaseCred, opts: { createdMin?: string; maxPages?: number } = {}): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const maxPages = Math.min(Math.max(opts.maxPages ?? 20, 1), 50);
  let sinceId = "0";
  for (let i = 0; i < maxPages; i++) {
    const qs = new URLSearchParams({ status: "any", limit: "250", order: "id asc", since_id: sinceId });
    if (opts.createdMin) qs.set("created_at_min", opts.createdMin);
    const j = await shopbaseApi(cred, `orders.json?${qs}`);
    const batch = (Array.isArray(j.orders) ? j.orders : []) as Record<string, unknown>[];
    if (!batch.length) break;
    out.push(...batch);
    const lastId = strv(batch[batch.length - 1]?.id);
    if (!lastId || lastId === sinceId) break;
    sinceId = lastId;
    if (batch.length < 250) break;   // trang cuối
  }
  return out;
}
