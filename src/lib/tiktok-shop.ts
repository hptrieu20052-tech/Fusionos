import crypto from "crypto";
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
        create_time_ge: p?.createdAfter ?? Math.floor(Date.now() / 1000) - 7 * 86400,
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
    items: merged,
  };
}
