import crypto from "crypto";
import { ingestSinceMs } from "@/lib/ingest-cutoff";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

// ===== TikTok Shop Open API (Partner Center, app dạng Custom) =====
// - 1 app authorize được NHIỀU shop (khác Etsy mỗi shop 1 app) — nhưng FUSION lưu app key/secret
//   theo store cho đồng bộ UI (dán cùng key cho các store là được).
// - Gateway: https://open-api.tiktokglobalshop.com (HTTPS bắt buộc từ 2026-06-17)
//   Auth:     https://auth.tiktok-shops.com
//   App đăng ký ở US Partner Portal có thể dùng gateway US — cho phép override qua ô endpoint.
// - MỌI request phải ký: sign = HMAC-SHA256(app_secret, app_secret + path + (sorted k+v) + body + app_secret)
// - Token: access ~7 ngày, refresh ~30 ngày — tự refresh khi còn <30 phút.

const TT_API = "https://open-api.tiktokglobalshop.com";
const TT_AUTH = "https://auth.tiktok-shops.com";

export type TtCfg = {
  appKey: string; appSecret: string;
  accessToken: string; refreshToken: string;
  accessExpiresAt: number; // epoch giây
  shopId: string; shopCipher: string; shopName: string;
  apiBase?: string;
};

export function readTtCfg(c: Record<string, string> | null | undefined): TtCfg {
  const cc = c ?? {};
  return {
    appKey: cc.tiktok_app_key ?? "",
    appSecret: decryptSecret(cc.tiktok_app_secret),
    accessToken: decryptSecret(cc.tiktok_access_token),
    refreshToken: decryptSecret(cc.tiktok_refresh_token),
    accessExpiresAt: Number(cc.tiktok_access_expires_at ?? 0),
    shopId: cc.tiktok_shop_id ?? "",
    shopCipher: cc.tiktok_shop_cipher ?? "",
    shopName: cc.tiktok_shop_name ?? "",
    apiBase: cc.tiktok_api_base || undefined,
  };
}

export function writeTtCfg(existing: Record<string, string> | null | undefined, patch: Partial<TtCfg>): Record<string, string> {
  const next: Record<string, string> = { ...(existing ?? {}) };
  if (patch.appKey !== undefined) next.tiktok_app_key = patch.appKey;
  if (patch.appSecret !== undefined) next.tiktok_app_secret = encryptSecret(patch.appSecret);
  if (patch.accessToken !== undefined) next.tiktok_access_token = encryptSecret(patch.accessToken);
  if (patch.refreshToken !== undefined) next.tiktok_refresh_token = encryptSecret(patch.refreshToken);
  if (patch.accessExpiresAt !== undefined) next.tiktok_access_expires_at = String(patch.accessExpiresAt);
  if (patch.shopId !== undefined) next.tiktok_shop_id = patch.shopId;
  if (patch.shopCipher !== undefined) next.tiktok_shop_cipher = patch.shopCipher;
  if (patch.shopName !== undefined) next.tiktok_shop_name = patch.shopName;
  if (patch.apiBase !== undefined) next.tiktok_api_base = patch.apiBase ?? "";
  return next;
}

/**
 * App key/secret của PARTNER dùng chung (theyourlist) — khi shop authorize qua app của họ
 * (redirect auth.theyourlist.com) thay vì app riêng. Lấy từ env; token exchange + refresh
 * đều phải dùng đúng cặp key này.
 */
/**
 * Tiền tố `state` để theyourlist nhận diện đây là shop của FUSION (không lẫn với hệ thống cũ "sto_").
 * theyourlist forward về Fusion khi state khớp tiền tố này. Đổi qua env nếu cần.
 * (Bên theyourlist phải thêm nhánh: if (explode('_', $state)[0] == '<tiền tố>') → gửi về Fusion.)
 */
export const FUSION_STATE_PREFIX = (process.env.FUSION_TT_STATE_PREFIX?.trim() || "sto");

/** Bọc storeId thành state gửi TikTok: "<prefix>_<storeId>". */
export const wrapTtState = (storeId: string) => `${FUSION_STATE_PREFIX}_${storeId}`;

/** Gỡ tiền tố về storeId (chấp nhận cả tiền tố Fusion mới lẫn "sto_" cũ để không vỡ đơn đang chạy). */
export function unwrapTtState(state: string): string {
  const s = (state ?? "").trim();
  for (const pfx of [FUSION_STATE_PREFIX, "sto"]) {
    if (s.startsWith(pfx + "_")) return s.slice(pfx.length + 1);
  }
  return s;
}

export function theyourlistApp(): { appKey: string; appSecret: string } | null {
  const appKey = process.env.THEYOURLIST_APP_KEY?.trim();
  const appSecret = process.env.THEYOURLIST_APP_SECRET?.trim();
  return appKey && appSecret ? { appKey, appSecret } : null;
}

const ft = () => ({ signal: AbortSignal.timeout(25000) });

// ===== Chữ ký request =====
function ttSign(appSecret: string, path: string, params: Record<string, string>, body: string): string {
  const keys = Object.keys(params).filter((k) => k !== "sign" && k !== "access_token").sort();
  const concat = keys.map((k) => k + params[k]).join("");
  const base = appSecret + path + concat + body + appSecret;
  return crypto.createHmac("sha256", appSecret).update(base).digest("hex");
}

async function ttFetch(cfg: TtCfg, method: "GET" | "POST" | "PUT", path: string, query: Record<string, string>, bodyObj?: unknown) {
  const base = cfg.apiBase?.replace(/\/$/, "") || TT_API;
  const body = bodyObj ? JSON.stringify(bodyObj) : "";
  const params: Record<string, string> = {
    ...query,
    app_key: cfg.appKey,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  if (cfg.shopCipher && !params.shop_cipher) params.shop_cipher = cfg.shopCipher;
  params.sign = ttSign(cfg.appSecret, path, params, body);
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${base}${path}?${qs}`, {
    method,
    headers: { "Content-Type": "application/json", "x-tts-access-token": cfg.accessToken },
    body: method !== "GET" ? body : undefined,
    ...ft(),
  });
  const j = (await r.json().catch(() => ({}))) as { code?: number; message?: string; data?: unknown };
  if (!r.ok || (j.code !== undefined && j.code !== 0)) {
    throw new Error(`TikTok API ${path}: HTTP ${r.status} code=${j.code} ${j.message ?? ""}`.trim());
  }
  return j.data as Record<string, unknown>;
}

// ===== OAuth: đổi auth code / refresh token (KHÔNG cần sign) =====
export async function ttExchangeToken(appKey: string, appSecret: string, p: { authCode?: string; refreshToken?: string }) {
  const q = p.authCode
    ? `app_key=${appKey}&app_secret=${appSecret}&auth_code=${encodeURIComponent(p.authCode)}&grant_type=authorized_code`
    : `app_key=${appKey}&app_secret=${appSecret}&refresh_token=${encodeURIComponent(p.refreshToken!)}&grant_type=refresh_token`;
  const r = await fetch(`${TT_AUTH}/api/v2/token/get?${q}`, ft());
  const j = (await r.json().catch(() => ({}))) as { code?: number; message?: string; data?: Record<string, unknown> };
  if (!r.ok || j.code !== 0 || !j.data?.access_token) {
    throw new Error(`TikTok token failed: HTTP ${r.status} code=${j.code} ${j.message ?? ""}`.trim());
  }
  const d = j.data;
  return {
    accessToken: String(d.access_token),
    refreshToken: String(d.refresh_token ?? p.refreshToken ?? ""),
    accessExpiresAt: Number(d.access_token_expire_in ?? 0), // epoch giây
  };
}

// ===== Lấy shop đã authorize (để có shop_id + shop_cipher) =====
export async function ttGetAuthorizedShops(cfg: TtCfg) {
  const d = await ttFetch({ ...cfg, shopCipher: "" }, "GET", "/authorization/202309/shops", {});
  const shops = (d?.shops as Record<string, unknown>[] | undefined) ?? [];
  return shops.map((s) => ({
    id: String(s.id ?? ""),
    cipher: String(s.cipher ?? ""),
    name: String(s.name ?? ""),
    region: String(s.region ?? ""),
    sellerType: String(s.seller_type ?? ""),
  }));
}

// Probe an toàn: gọi 1 endpoint, KHÔNG ném lỗi — trả code/message để biết app có quyền không.
// code=40006 "no schema found" = app KHÔNG có quyền gọi API này (thiếu trong schema app).
export async function ttProbe(cfg: TtCfg, method: "GET" | "POST", path: string, query: Record<string, string> = {}, body?: unknown): Promise<{ path: string; ok: boolean; httpStatus: number; code?: number; message?: string; dataKeys?: string[] }> {
  const base = cfg.apiBase?.replace(/\/$/, "") || TT_API;
  const bodyStr = body ? JSON.stringify(body) : "";
  const params: Record<string, string> = { ...query, app_key: cfg.appKey, timestamp: String(Math.floor(Date.now() / 1000)) };
  if (cfg.shopCipher && !params.shop_cipher) params.shop_cipher = cfg.shopCipher;
  params.sign = ttSign(cfg.appSecret, path, params, bodyStr);
  try {
    const r = await fetch(`${base}${path}?${new URLSearchParams(params).toString()}`, {
      method, headers: { "Content-Type": "application/json", "x-tts-access-token": cfg.accessToken },
      body: method === "POST" ? bodyStr : undefined, ...ft(),
    });
    const j = (await r.json().catch(() => ({}))) as { code?: number; message?: string; data?: Record<string, unknown> };
    return { path, ok: r.ok && j.code === 0, httpStatus: r.status, code: j.code, message: (j.message ?? "").slice(0, 120), dataKeys: j.data ? Object.keys(j.data) : undefined };
  } catch (e) {
    return { path, ok: false, httpStatus: 0, message: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

// Tìm package của 1 đơn (fulfillment/packages/search — đã xác nhận app có quyền, code=0).
// Package chỉ có sau khi đơn off-hold + Arrange shipment. Trả mảng package thô để lấy id.
export async function ttSearchPackages(cfg: TtCfg, orderId: string) {
  const d = await ttFetch(cfg, "POST", "/fulfillment/202309/packages/search", { page_size: "50" }, { order_ids: [orderId] });
  return (d?.packages as Record<string, unknown>[] | undefined) ?? [];
}

// Lấy shipping document (label PDF) của 1 package → trả doc_url (link ký sẵn của TikTok).
// Dùng cho đơn Ship-by-TikTok: lấy link này gửi supplier (FlashPOD/Onos/Merchize).
export async function ttGetShippingDocument(cfg: TtCfg, packageId: string, opts?: { docType?: string; format?: string; size?: string }) {
  const d = await ttFetch(cfg, "GET", `/fulfillment/202309/packages/${packageId}/shipping_documents`, {
    document_type: opts?.docType ?? "SHIPPING_LABEL",
    document_size: opts?.size ?? "A6",
    document_format: opts?.format ?? "PDF",
  });
  return d as { doc_url?: string } & Record<string, unknown>;
}

// ===== AUTO-ARRANGE (mua nhãn TikTok) — scope seller.fulfillment.basic (theyourlist có) =====
// Get Eligible Shipping Service: POST /fulfillment/202309/orders/{id}/shipping_services/query → list dịch vụ.
export async function ttGetShippingServices(cfg: TtCfg, orderId: string): Promise<{ serviceId: string | null; raw: unknown }> {
  const d = await ttFetch(cfg, "POST", `/fulfillment/202309/orders/${orderId}/shipping_services/query`, {}, {});
  const list = (d?.shipping_services as { id?: string; is_default?: boolean }[] | undefined) ?? [];
  const def = list.find((s) => s.is_default) ?? list[0];
  return { serviceId: def?.id ? String(def.id) : null, raw: d };
}

// Create Packages 202512: POST /fulfillment/202512/packages → TẠO PACKAGE + MUA NHÃN (Arrange). TỐN PHÍ ~$3.95.
// ship_type=1: gộp cả đơn 1 package/1 tracking. shipping_service_id optional (bỏ → TikTok dùng default).
export async function ttCreatePackage(cfg: TtCfg, orderId: string, shippingServiceId?: string | null): Promise<{ packageId: string | null; raw: unknown }> {
  const body: Record<string, unknown> = { ship_type: "1", order_id: orderId };
  if (shippingServiceId) body.shipping_service_id = shippingServiceId;
  const d = await ttFetch(cfg, "POST", "/fulfillment/202512/packages", {}, body);
  const pkgs = (d?.packages as { id?: string; package_id?: string }[] | undefined) ?? [];
  const pid = pkgs[0]?.id ?? pkgs[0]?.package_id ?? (d?.package_id ? String(d.package_id) : null);
  return { packageId: pid ? String(pid) : null, raw: d };
}

// ===== PRODUCT API (Manage Products) — scope seller.product.basic =====
// Search Products 202502: POST /product/202502/products/search. page_size/page_token ở query, filter ở body.
export async function ttSearchProducts(cfg: TtCfg, body: Record<string, unknown>, pageToken?: string, pageSize = 100): Promise<{ products: Record<string, unknown>[]; nextPageToken: string; totalCount: number }> {
  const query: Record<string, string> = { page_size: String(pageSize) };
  if (pageToken) query.page_token = pageToken;
  const d = await ttFetch(cfg, "POST", "/product/202502/products/search", query, body ?? {});
  return {
    products: (d?.products as Record<string, unknown>[] | undefined) ?? [],
    nextPageToken: d?.next_page_token ? String(d.next_page_token) : "",
    totalCount: Number(d?.total_count ?? 0),
  };
}

// ===== CLONE / EDIT / UPLOAD (Manage Products Phase 3) — scope seller.product.write =====
// Get Product Detail 202309: GET /product/202309/products/{id} → full product (title, desc, category_chains,
// brand, main_images[uri], skus[price/inventory/sales_attributes], package_weight/dimensions, product_attributes).
export async function ttGetProductDetail(cfg: TtCfg, productId: string): Promise<Record<string, unknown>> {
  const d = await ttFetch(cfg, "GET", `/product/202309/products/${productId}`, { return_under_review_version: "false" });
  return d ?? {};
}

// Create Product 202309: POST /product/202309/products (scope write). save_mode: LISTING = đăng bán luôn, AS_DRAFT = nháp.
export async function ttCreateProduct(cfg: TtCfg, body: Record<string, unknown>): Promise<{ productId: string | null; raw: Record<string, unknown> }> {
  const d = await ttFetch(cfg, "POST", "/product/202309/products", {}, body);
  const pid = (d?.product_id ?? (d?.product as { id?: string } | undefined)?.id) as string | undefined;
  return { productId: pid ? String(pid) : null, raw: d ?? {} };
}

// Edit Product 202309: PUT /product/202309/products/{id} (scope write) — body full-replace giống Create.
export async function ttEditProduct(cfg: TtCfg, productId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const d = await ttFetch(cfg, "PUT", `/product/202309/products/${productId}`, {}, body);
  return d ?? {};
}

// Get Warehouses (logistics) — cần warehouse_id cho inventory khi Create (nếu source thiếu).
export async function ttGetWarehouses(cfg: TtCfg): Promise<{ id: string; name: string; isDefault: boolean }[]> {
  const d = await ttFetch(cfg, "GET", "/logistics/202309/warehouses", {});
  return ((d?.warehouses as Record<string, unknown>[] | undefined) ?? []).map((w) => ({
    id: String(w.id ?? ""), name: String(w.name ?? ""), isDefault: !!(w.is_default ?? w.default),
  }));
}

// Get Categories 202309 (đầy đủ cây; để đổi category ở phase sau). locale vd en-US.
export async function ttGetCategories(cfg: TtCfg, locale = "en-US"): Promise<Record<string, unknown>[]> {
  const d = await ttFetch(cfg, "GET", "/product/202309/categories", { locale });
  return (d?.categories as Record<string, unknown>[] | undefined) ?? [];
}

// Get Category Attributes 202309 — thuộc tính (bắt buộc/tuỳ chọn) theo category leaf.
export async function ttGetCategoryAttributes(cfg: TtCfg, categoryId: string, locale = "en-US"): Promise<Record<string, unknown>[]> {
  const d = await ttFetch(cfg, "GET", `/product/202309/categories/${categoryId}/attributes`, { locale });
  return (d?.attributes as Record<string, unknown>[] | undefined) ?? [];
}

// Upload Product Image 202309 — multipart (KHÔNG ký body). Trả uri để nhét vào main_images/sku_img khi Create/Edit.
// data: bytes ảnh; use_case: MAIN_IMAGE | ATTRIBUTE_IMAGE | DESCRIPTION_IMAGE ...
export async function ttUploadProductImage(cfg: TtCfg, bytes: Uint8Array, filename: string, useCase = "MAIN_IMAGE"): Promise<{ uri: string | null; url: string | null; raw: unknown }> {
  const path = "/product/202309/images/upload";
  // Endpoint upload ảnh KHÔNG nhận shop_cipher (TikTok trả 36009004 nếu có) → không thêm.
  const params: Record<string, string> = { app_key: cfg.appKey, timestamp: String(Math.floor(Date.now() / 1000)) };
  params.sign = ttSign(cfg.appSecret, path, params, ""); // multipart: body KHÔNG vào chữ ký
  const fd = new FormData();
  fd.append("data", new Blob([bytes as BlobPart]), filename);
  fd.append("use_case", useCase);
  const base = cfg.apiBase?.replace(/\/$/, "") || TT_API;
  const r = await fetch(`${base}${path}?${new URLSearchParams(params).toString()}`, {
    method: "POST", headers: { "x-tts-access-token": cfg.accessToken }, body: fd, ...ft(),
  });
  const j = (await r.json().catch(() => ({}))) as { code?: number; message?: string; data?: { uri?: string; url?: string } };
  if (!r.ok || (j.code !== undefined && j.code !== 0)) {
    throw new Error(`TikTok upload image: HTTP ${r.status} code=${j.code} ${j.message ?? ""}`.trim());
  }
  return { uri: j.data?.uri ? String(j.data.uri) : null, url: j.data?.url ? String(j.data.url) : null, raw: j.data };
}

// ===== CHẨN ĐOÁN (read-only) — lấy Order Detail thật để biết shape package/shipping =====
// Get Order Detail 202309: GET /order/202309/orders?ids=<comma>. Trả orders[] kèm packages, line_items,
// shipping_type/fulfillment_type, delivery_option... Dùng để xác minh trước khi viết ship/label.
export async function ttGetOrderDetail(cfg: TtCfg, ids: string[]) {
  const d = await ttFetch(cfg, "GET", "/order/202309/orders", { ids: ids.join(",") });
  return (d?.orders as Record<string, unknown>[] | undefined) ?? [];
}

// Danh sách shipping provider (để map carrier → provider_id khi đẩy tracking Seller Shipping).
// Path 202309 có thể khác theo region → thử vài biến thể, trả cái nào chạy + lỗi cái không chạy.
export async function ttGetShippingProviders(cfg: TtCfg): Promise<{ ok: boolean; path?: string; data?: unknown; errors: string[] }> {
  const candidates = [
    "/logistics/202309/shipping_providers",
    "/logistics/202309/delivery_options",
    "/logistics/202309/warehouses",
  ];
  const errors: string[] = [];
  for (const path of candidates) {
    try {
      const d = await ttFetch(cfg, "GET", path, {});
      return { ok: true, path, data: d, errors };
    } catch (e) {
      errors.push(`${path}: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
    }
  }
  return { ok: false, errors };
}

// Lấy package_id của ĐÚNG 1 đơn. Order Detail.packages có sau khi Arrange; nếu trống thì
// search (trả cả shop) rồi lọc theo orders[].id === orderExtId. Trả [{ id, trackingNumber }].
export async function ttGetPackageIdsForOrder(cfg: TtCfg, orderExtId: string): Promise<{ id: string; trackingNumber?: string }[]> {
  // 1) Order Detail
  try {
    const orders = await ttGetOrderDetail(cfg, [orderExtId]);
    const pkgs = (orders[0]?.packages as Record<string, unknown>[] | undefined) ?? [];
    const ids = pkgs.map((p) => ({ id: String(p.id ?? p.package_id ?? ""), trackingNumber: p.tracking_number ? String(p.tracking_number) : undefined })).filter((x) => x.id);
    if (ids.length) return ids;
  } catch { /* fallback bên dưới */ }
  // 2) Search toàn shop → lọc theo order id (quét tối đa vài trang gần nhất)
  let pageToken = "";
  for (let i = 0; i < 4; i++) {
    const d = await ttFetch(cfg, "POST", "/fulfillment/202309/packages/search", { page_size: "50", ...(pageToken ? { page_token: pageToken } : {}) }, {});
    const pkgs = (d?.packages as Record<string, unknown>[] | undefined) ?? [];
    const hit = pkgs.filter((p) => Array.isArray(p.orders) && (p.orders as Record<string, unknown>[]).some((o) => String(o.id) === orderExtId));
    if (hit.length) return hit.map((p) => ({ id: String(p.id), trackingNumber: p.tracking_number ? String(p.tracking_number) : undefined }));
    pageToken = String(d?.next_page_token ?? "");
    if (!pageToken) break;
  }
  return [];
}

// ===== Đẩy tracking Seller Shipping lên TikTok (mark shipped) =====
// Endpoint đã xác nhận có quyền: POST /fulfillment/202309/orders/{id}/packages (đòi tracking_number).
// provider_id lấy từ order detail (nếu có); rỗng thì bỏ, để TikTok tự nhận theo format tracking.
export async function ttShipPackage(cfg: TtCfg, p: { orderId: string; orderLineItemIds: string[]; trackingNumber: string; providerId?: string }) {
  const body: Record<string, unknown> = { tracking_number: p.trackingNumber };
  if (p.orderLineItemIds.length) body.order_line_item_ids = p.orderLineItemIds;
  if (p.providerId) body.shipping_provider_id = p.providerId;
  return ttFetch(cfg, "POST", `/fulfillment/202309/orders/${p.orderId}/packages`, {}, body);
}

// ===== Token hợp lệ: tự refresh khi sắp hết hạn, lưu ngược vào store =====
export async function ttGetValidCfg(storeId: string, cred: Record<string, string> | null): Promise<TtCfg> {
  let cfg = readTtCfg(cred);
  if (!cfg.appKey || !cfg.refreshToken) throw new Error("TikTok not connected");
  const now = Math.floor(Date.now() / 1000);
  if (!cfg.accessToken || cfg.accessExpiresAt - now < 1800) {
    const t = await ttExchangeToken(cfg.appKey, cfg.appSecret, { refreshToken: cfg.refreshToken });
    const next = writeTtCfg(cred, t);
    await db.update(schema.stores).set({ apiCredentials: next }).where(eq(schema.stores.id, storeId));
    cfg = readTtCfg(next);
  }
  return cfg;
}

// ===== Đơn hàng =====
export async function ttSearchOrders(cfg: TtCfg, p?: { createdAfter?: number; pageSize?: number; status?: string | null }) {
  const orders: Record<string, unknown>[] = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) {
    const d = await ttFetch(cfg, "POST", "/order/202309/orders/search",
      { page_size: String(p?.pageSize ?? 50), ...(pageToken ? { page_token: pageToken } : {}), sort_order: "DESC", sort_field: "create_time" },
      {
        create_time_ge: Math.max(p?.createdAfter ?? Math.floor(Date.now() / 1000) - 7 * 86400, Math.floor(ingestSinceMs() / 1000) || 0),
        // Mặc định chỉ đơn chờ fulfill — đơn đã ship/hoàn tất ở hệ cũ không bị kéo về.
        // status: null = lấy mọi trạng thái (dùng để chẩn đoán).
        ...(p?.status === null ? {} : { order_status: p?.status ?? "AWAITING_SHIPMENT" }),
      });
    const batch = (d?.orders as Record<string, unknown>[] | undefined) ?? [];
    orders.push(...batch);
    pageToken = String(d?.next_page_token ?? "");
    if (!pageToken || !batch.length) break;
  }
  return orders;
}

// ===== Chuẩn hoá về InOrder (khớp ingest) =====
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const cents = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };

export function ttNormalizeOrder(o: Record<string, unknown>) {
  const addr = (o.recipient_address ?? {}) as Record<string, unknown>;
  const pay = (o.payment ?? {}) as Record<string, unknown>;
  const fullName = s(addr.name) ?? "";
  const sp = fullName.split(/\s+/);
  const items = (((o.line_items ?? []) as Record<string, unknown>[])).map((li) => ({
    title: s(li.product_name) ?? "TikTok item",
    qty: 1, // TikTok tách mỗi line item = 1 sản phẩm
    price: cents(li.sale_price ?? (li as Record<string, unknown>).original_price) || Number(li.sale_price ?? 0),
    sku: s(li.seller_sku) ?? undefined,
    variant: s(li.sku_name) ?? undefined,
    imageUrl: s(li.sku_image) ?? undefined,
    listingId: s(li.product_id) ?? undefined,
  }));
  // Gộp line item trùng SKU thành qty
  const merged: typeof items = [];
  for (const it of items) {
    const prev = merged.find((x) => x.sku && x.sku === it.sku && x.variant === it.variant && x.title === it.title);
    if (prev) prev.qty += 1;
    else merged.push({ ...it });
  }
  // total_amount TikTok trả dạng chuỗi số thập phân ("53.17") — không phải cents
  const total = Number(pay.total_amount ?? 0) || undefined;
  return {
    externalId: s(o.id) ?? "",
    buyerFirst: sp.slice(0, -1).join(" ") || sp[0] || undefined,
    buyerLast: sp.length > 1 ? sp[sp.length - 1] : undefined,
    addr1: s(addr.address_line1) ?? s((addr.address_detail as string)) ?? undefined,
    addr2: s(addr.address_line2) ?? undefined,
    city: s(addr.city) ?? (Array.isArray(addr.district_info) ? s((addr.district_info as Record<string, unknown>[]).find((d) => d.address_level_name === "City")?.address_name) ?? undefined : undefined),
    state: s(addr.state) ?? (Array.isArray(addr.district_info) ? s((addr.district_info as Record<string, unknown>[]).find((d) => d.address_level_name === "State")?.address_name) ?? undefined : undefined),
    zip: s(addr.zipcode) ?? s(addr.postal_code) ?? undefined,
    country: s(addr.region_code) === "US" ? "United States" : (s(addr.region_code) ?? undefined),
    phone: s(addr.phone_number) ?? undefined,
    total,
    note: s(o.buyer_message) ?? undefined,
    platformStatus: s(o.status) ?? undefined,
    // Fulfillment type: "TIKTOK" = Ship by TikTok (get label) · "SELLER" = Ship by Seller.
    // TikTok đặt tên field khác nhau theo version API → dò cả 3.
    shippingType: ((): string | undefined => {
      const raw = String(o.shipping_type ?? o.fulfillment_type ?? o.delivery_option_type ?? "").toUpperCase();
      if (/TIKTOK|TT|PLATFORM|FBT|FULFILLED_BY_TIKTOK/.test(raw)) return "TIKTOK";
      if (/SELLER|SELF|MERCHANT/.test(raw)) return "SELLER";
      return raw || undefined;
    })(),
    items: merged,
  };
}
