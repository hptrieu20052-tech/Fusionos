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

async function ttFetch(cfg: TtCfg, method: "GET" | "POST", path: string, query: Record<string, string>, bodyObj?: unknown) {
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
    body: method === "POST" ? body : undefined,
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
