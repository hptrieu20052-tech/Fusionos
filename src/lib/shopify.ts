import crypto from "crypto";
import type { InOrder, InItem } from "@/lib/ingest-etsy";

// ============================================================================
//  SHOPIFY — kết nối store Shopify với FUSION.
//  Credentials lưu ở stores.api_credentials (jsonb):
//    { shopDomain: "xxx.myshopify.com", adminToken: "shpat_...", webhookSecret: "..." }
//  KHÔNG commit token vào code — nhập ở UI Stores hoặc SQL.
// ============================================================================

// clientId/clientSecret = app Dev Dashboard (token cấp qua client_credentials, tự hết hạn 24h).
// adminToken = token cố định kiểu legacy custom app (nếu có thì dùng thẳng).
// webhookSecret = bí mật ký webhook; app Dev Dashboard ký bằng CHÍNH clientSecret.
export type ShopifyCred = { shopDomain?: string; adminToken?: string; clientId?: string; clientSecret?: string; webhookSecret?: string };
const API_VER = "2024-10";

export function shopHost(cred: ShopifyCred): string {
  return String(cred.shopDomain ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
// Secret dùng verify HMAC: ưu tiên webhookSecret, else clientSecret (app Dev Dashboard).
export function webhookSecretOf(cred: ShopifyCred): string {
  return String(cred.webhookSecret ?? cred.clientSecret ?? "").trim();
}

// Cache access token theo shop (client_credentials trả token sống ~24h → xin lại trước hạn).
const tokenCache = new Map<string, { token: string; exp: number }>();
async function getAccessToken(cred: ShopifyCred): Promise<string> {
  const host = shopHost(cred);
  if (cred.adminToken && String(cred.adminToken).trim()) return String(cred.adminToken).trim(); // legacy token cố định
  const id = String(cred.clientId ?? "").trim(), secret = String(cred.clientSecret ?? "").trim();
  if (!host || !id || !secret) throw new Error("Shopify store chưa cấu hình shopDomain + clientId + clientSecret (hoặc adminToken)");
  const hit = tokenCache.get(host);
  if (hit && hit.exp - 120_000 > Date.now()) return hit.token;
  const res = await fetch(`https://${host}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: id, client_secret: secret, grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify token HTTP ${res.status}: ${text.slice(0, 200)}`);
  let d: { access_token?: string; expires_in?: number };
  try { d = JSON.parse(text); } catch { throw new Error("Shopify token: phản hồi không phải JSON"); }
  if (!d.access_token) throw new Error("Shopify token: không có access_token");
  tokenCache.set(host, { token: d.access_token, exp: Date.now() + (Number(d.expires_in) || 86399) * 1000 });
  return d.access_token;
}

// Gọi Admin REST API. Trả JSON (hoặc ném lỗi có nội dung để log).
export async function shopifyApi(cred: ShopifyCred, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const host = shopHost(cred);
  const token = await getAccessToken(cred);
  if (!host) throw new Error("Shopify store chưa cấu hình shopDomain");
  const res = await fetch(`https://${host}/admin/api/${API_VER}/${path.replace(/^\/+/, "")}`, {
    ...init,
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${text.slice(0, 300)}`);
  try { return text ? JSON.parse(text) : {}; } catch { throw new Error("Shopify: phản hồi không phải JSON"); }
}

// Gọi Admin GraphQL API — DÙNG CHO PRODUCTS (REST products/variants đã bị Shopify deprecate).
// Trả về data; ném lỗi nếu có top-level errors hoặc userErrors (gộp message để log).
export async function shopifyGraphQL<T = Record<string, unknown>>(
  cred: ShopifyCred, query: string, variables: Record<string, unknown> = {},
): Promise<T> {
  const host = shopHost(cred);
  const token = await getAccessToken(cred);
  if (!host) throw new Error("Shopify store chưa cấu hình shopDomain");
  const res = await fetch(`https://${host}/admin/api/${API_VER}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });
  const textBody = await res.text();
  if (!res.ok) throw new Error(`Shopify GraphQL HTTP ${res.status}: ${textBody.slice(0, 300)}`);
  let j: { data?: T; errors?: { message?: string }[] };
  try { j = JSON.parse(textBody); } catch { throw new Error("Shopify GraphQL: phản hồi không phải JSON"); }
  if (j.errors?.length) throw new Error("Shopify GraphQL: " + j.errors.map((e) => e.message).join("; ").slice(0, 300));
  return (j.data ?? {}) as T;
}

// Xác thực webhook: HMAC-SHA256(raw body, secret) → base64, so với header X-Shopify-Hmac-Sha256.
// So sánh timing-safe. secret = "API secret key" của Custom App.
export function verifyShopifyHmac(rawBody: string, hmacHeader: string, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  try {
    const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
    const a = Buffer.from(digest); const b = Buffer.from(hmacHeader);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const strv = (v: unknown) => (v == null ? "" : String(v)).trim();

// Gom line_items[].properties (cá nhân hoá) → mỗi field MỘT DÒNG "Name: Value" + tách ảnh khách upload.
// v189 · đổi " · " thành xuống dòng — trước đây cả chục field dính thành 1 cục, không đọc nổi.
function splitProperties(props: unknown): { personalization: string; files: { name: string; url: string }[] } {
  const arr = Array.isArray(props) ? (props as { name?: unknown; value?: unknown }[]) : [];
  const parts: string[] = []; const files: { name: string; url: string }[] = [];
  for (const p of arr) {
    const name = strv(p?.name); const value = strv(p?.value);
    if (!name || !value || name.startsWith("_")) { // Shopify dùng "_" cho property ẩn (hệ thống)
      if (/^https?:\/\/\S+\.(jpe?g|png|webp|heic|pdf)/i.test(value)) files.push({ name: name || "upload", url: value });
      continue;
    }
    if (/^https?:\/\/\S+/i.test(value)) { files.push({ name, url: value }); parts.push(`${name}: ${value}`); }
    else parts.push(`${name}: ${value}`);
  }
  return { personalization: parts.join("\n"), files };
}

// Chuẩn hoá đơn Shopify (Admin API / webhook orders/create) → InOrder cho insertEtsyOrders.
export function normalizeShopifyOrder(o: Record<string, unknown>): InOrder {
  const ship = (o.shipping_address ?? o.customer ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(o.line_items) ? o.line_items : []) as Record<string, unknown>[];
  const mapped: InItem[] = items.map((li) => {
    const { personalization, files } = splitProperties(li.properties);
    return {
      title: strv(li.title) || strv(li.name) || "Shopify item",
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
  return {
    externalId: strv(o.id) || strv(o.name) || strv(o.order_number), // id SỐ để round-trip API (fulfillment) chắc chắn
    buyerFirst: strv(ship.first_name) || sp.slice(0, -1).join(" ") || sp[0] || undefined,
    buyerLast: strv(ship.last_name) || (sp.length > 1 ? sp[sp.length - 1] : undefined),
    addr1: strv(ship.address1) || undefined,
    addr2: strv(ship.address2) || undefined,
    city: strv(ship.city) || undefined,
    state: strv(ship.province) || strv(ship.province_code) || undefined,
    zip: strv(ship.zip) || undefined,
    country: strv(ship.country) || strv(ship.country_code) || "United States",
    total: num(o.total_price) || num(o.current_total_price),
    // fee KHÔNG lấy từ Shopify (phí thanh toán chỉ có ở payout) → để 0 = ước tính theo % shop (Fee est.)
    note: strv(o.note) || undefined,
    platformStatus: strv(o.financial_status) || strv(o.fulfillment_status) || undefined,
    items: mapped,
  };
}

// Tách đơn Shopify theo SELLER (khớp product_id ↔ listing đã Push ↔ seller gốc).
// Trả về [{ sellerId, order }]. 1 nhóm → 1 đơn (mã gốc). Nhiều nhóm (giỏ trộn seller) → đơn gốc + -CLONE-n,
// total chia theo TỈ LỆ giá trị item của từng seller (fee ước tính theo % shop sẽ tự tỉ lệ theo total).
// Item không map được (list tay trên Shopify) → gán adminSellerId để support/admin vẫn thấy mà fulfill.
export function splitShopifyOrderBySeller(
  o: Record<string, unknown>,
  resolveSeller: (productId: string) => string | null,
  adminSellerId: string | null,
): { sellerId: string | null; order: InOrder }[] {
  const base = normalizeShopifyOrder(o);
  const groups = new Map<string, { sellerId: string | null; items: InItem[]; subtotal: number }>();
  for (const it of (base.items ?? [])) {
    const pid = String(it.listingId ?? "").replace(/\D/g, "");
    const sid = (pid && resolveSeller(pid)) || adminSellerId || null;
    const key = sid ?? "∅";
    const g = groups.get(key) ?? { sellerId: sid, items: [], subtotal: 0 };
    g.items.push(it);
    g.subtotal += num(it.price) * (num(it.qty) || 1);
    groups.set(key, g);
  }
  const arr = Array.from(groups.values());
  if (arr.length <= 1) return [{ sellerId: arr[0]?.sellerId ?? adminSellerId ?? null, order: base }];

  const totalOrder = num(o.total_price) || num(o.current_total_price) || arr.reduce((a, g) => a + g.subtotal, 0);
  const sumSub = arr.reduce((a, g) => a + g.subtotal, 0) || 1;
  const baseExt = base.externalId;
  return arr.map((g, i) => ({
    sellerId: g.sellerId,
    order: {
      ...base,
      externalId: i === 0 ? baseExt : `${baseExt}-CLONE-${i}`,
      items: g.items,
      total: Math.round(totalOrder * (g.subtotal / sumSub) * 100) / 100,
    },
  }));
}

// ---- ĐẨY TRACKING NGƯỢC LÊN SHOPIFY (tạo fulfillment → khách nhận email "đã gửi hàng") ----
// Shopify 2024-10: cần fulfillment_order_id (lấy từ /orders/{id}/fulfillment_orders) rồi POST /fulfillments.
export async function createShopifyFulfillment(
  cred: ShopifyCred, shopifyOrderId: string, tracking: { number: string; carrier?: string; url?: string },
): Promise<void> {
  const foRes = await shopifyApi(cred, `orders/${encodeURIComponent(shopifyOrderId)}/fulfillment_orders.json`);
  const fos = (Array.isArray(foRes.fulfillment_orders) ? foRes.fulfillment_orders : []) as Record<string, unknown>[];
  const open = fos.filter((f) => ["open", "in_progress", "scheduled"].includes(String(f.status)));
  if (!open.length) throw new Error("Shopify: đơn không còn fulfillment order mở (có thể đã fulfill)");
  await shopifyApi(cred, "fulfillments.json", {
    method: "POST",
    body: JSON.stringify({
      fulfillment: {
        line_items_by_fulfillment_order: open.map((f) => ({ fulfillment_order_id: f.id })),
        tracking_info: { number: tracking.number, company: tracking.carrier || undefined, url: tracking.url || undefined },
        notify_customer: true,
      },
    }),
  });
}

// ---- Đẩy tracking của 1 đơn Shopify (gọi tay + tự động sau khi nhà in trả tracking) ----
import { db, schema } from "@/lib/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

const platformExtId = (ext: string) => ext.replace(/-CLONE-\d+$/, ""); // đơn split dùng mã đơn THẬT

export async function pushShopifyTrackingForOrder(orderId: string): Promise<{ ok: boolean; pushed: number; reason?: string; errors: string[] }> {
  const [order] = await db.select({
    id: schema.orders.id, platform: schema.orders.platform, externalId: schema.orders.externalId, storeId: schema.orders.storeId,
  }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order) return { ok: false, pushed: 0, reason: "order not found", errors: [] };
  if (order.platform !== "shopify") return { ok: false, pushed: 0, reason: "not a Shopify order", errors: [] };
  if (!order.storeId) return { ok: false, pushed: 0, reason: "order has no store", errors: [] };

  const [store] = await db.select({ c: schema.stores.apiCredentials }).from(schema.stores).where(eq(schema.stores.id, order.storeId)).limit(1);
  const cred = (store?.c ?? {}) as ShopifyCred;
  if (!shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) return { ok: false, pushed: 0, reason: "store not connected to Shopify API", errors: [] };

  // Bản ghi fulfill CÓ tracking mà CHƯA đẩy lên Shopify
  const ffos = await db.select({
    id: schema.fulfillmentOrders.id, tracking: schema.fulfillmentOrders.trackingNumber,
    carrier: schema.fulfillmentOrders.trackingCarrier, url: schema.fulfillmentOrders.trackingUrl,
    attempts: schema.fulfillmentOrders.shopifyPushAttempts,
  }).from(schema.fulfillmentOrders).where(and(
    eq(schema.fulfillmentOrders.orderId, order.id),
    isNotNull(schema.fulfillmentOrders.trackingNumber),
    isNull(schema.fulfillmentOrders.shopifyTrackingPushedAt),
  ));
  if (!ffos.length) return { ok: true, pushed: 0, reason: "no new tracking to push", errors: [] };

  // Backoff tăng dần: 10' · 30' · 2h · 6h · 24h (chặn tối đa) — giống retry TikTok.
  const backoffMin = (n: number) => [10, 30, 120, 360, 1440][Math.min(n, 4)];

  let pushed = 0; const errors: string[] = []; const done = new Set<string>();
  for (const f of ffos) {
    const code = (f.tracking || "").trim();
    if (!code) continue;
    try {
      if (!done.has(code)) {
        await createShopifyFulfillment(cred, platformExtId(order.externalId), { number: code, carrier: f.carrier || undefined, url: f.url || undefined });
        done.add(code); pushed++;
      }
      // Thành công → xoá cờ lỗi/đếm/hẹn giờ để không bị cron quét lại.
      await db.update(schema.fulfillmentOrders).set({
        shopifyTrackingPushedAt: new Date(),
        shopifyPushError: null, shopifyPushNextAt: null,
      }).where(eq(schema.fulfillmentOrders.id, f.id));
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 300);
      errors.push(`${code}: ${msg.slice(0, 140)}`);
      const n = (f.attempts ?? 0) + 1;
      await db.update(schema.fulfillmentOrders).set({
        shopifyPushError: msg, shopifyPushAttempts: n,
        shopifyPushNextAt: new Date(Date.now() + backoffMin(n) * 60_000),
      }).where(eq(schema.fulfillmentOrders.id, f.id));
    }
  }
  return { ok: errors.length === 0, pushed, errors };
}

// Gọi an toàn từ webhook/sync — không phải Shopify hoặc lỗi thì bỏ qua êm.
export async function autoPushShopifyTracking(orderId: string) {
  try { return await pushShopifyTrackingForOrder(orderId); } catch { return null; }
}
