import crypto from "crypto";

/**
 * COMPASSUP (compassup.com) — nhà sourcing/dropship trung gian.
 *
 * Khác các nhà in POD: đơn KHÔNG có design (trừ item type="custom"). Sản phẩm đến từ sup
 * Trung Quốc khác nhau, nhưng Compassup GỘP thành 1 đơn = 1 tracking (xác nhận từ Hồ Triều).
 *
 * Endpoints (base https://order.compassup.com/openapi/1):
 *   POST /orders            → tạo đơn, trả data.id (= order_id)
 *   GET  /orders/fees       → mảng fees[] {name, name_translate, value, description} → CỘNG DỒN
 *   GET  /orders/track      → data.tracks[] {code, carrie(r), created_at}, batch tối đa 20 id
 *   GET  /product/detail    → product {pid, product_id, skus[], images[], ...}
 *
 * Auth: header Authorization: Bearer <token>, X-Tenant, sign.
 */

export type CompassupCred = {
  bearerToken: string;
  tenant: string;       // X-Tenant, vd "cpstech"
  restKey: string;      // secret ký sign
  endpoint?: string | null;
  username?: string;    // field "username" khi tạo đơn
};

const base = (c: CompassupCred) => (c.endpoint?.trim().replace(/\/+$/, "") || "https://order.compassup.com/openapi/1");

/**
 * Ký request theo doc Compassup:
 *   sbd = "params=" + JSON(ksort(params)) + "&secret=" + restKey + "&tenant=" + tenant
 *   sign = MD5(sbd) viết HOA
 *
 * BẪY: doc mẫu PHP dùng json_encode → ESCAPE ký tự non-ASCII thành \uXXXX (product_name
 * tiếng Trung!). JS JSON.stringify để raw → chữ ký KHÁC. Vì doc chính chủ viết bằng PHP,
 * mặc định dùng phpStyle=true. Có thể lật sang JS-style qua env nếu server báo sai sign.
 */
export function compassupSign(params: Record<string, unknown>, restKey: string, tenant: string, phpStyle = true): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(params).sort()) sorted[k] = params[k];
  let json = JSON.stringify(sorted);
  if (phpStyle) {
    // Giả lập json_encode của PHP: \uXXXX cho mọi ký tự > 0x7F; giữ '/' như PHP mặc định (\/)
    json = json.replace(/[\u0080-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
    json = json.replace(/\//g, "\\/");
  }
  const sbd = `params=${json}&secret=${restKey}&tenant=${tenant}`;
  return crypto.createHash("md5").update(sbd, "utf8").digest("hex").toUpperCase();
}

const PHP_STYLE = process.env.COMPASSUP_SIGN_JS_STYLE ? false : true;

function headers(c: CompassupCred, signParams: Record<string, unknown>) {
  return {
    "Authorization": `Bearer ${c.bearerToken}`,
    "X-Tenant": c.tenant,
    "sign": compassupSign(signParams, c.restKey, c.tenant, PHP_STYLE),
    "Content-Type": "application/json",
  };
}

// AbortSignal KHÔNG tạo ở module-level (bài học Printway: "order 1 OK, order 2 fail")
const ft = () => ({ signal: AbortSignal.timeout(30_000) });

type Envelope<T> = { code?: number; data?: T; msg?: unknown; success?: boolean };

// ---- Item để tạo đơn ----
export type CompassupItem = {
  product_id: string; sku_id: string; product_name: string; declaration_title: string;
  quantity: number; weight: number; attribute: string; image_link: string; link: string;
  sup_site: string; seller_id: string; state: string; warehouse_id: string;
  type?: string; // "custom" nếu là SP custom
  attachments?: { src: string; type: string }[];
};

export type CompassupOrderInput = {
  platform: string; account_id: string;
  shipping_country: string; shipping_from: string;
  shipping_name: string; shipping_phone: string; shipping_address: string;
  shipping_city: string; shipping_state: string; shipping_zipcode: string;
  own_code: string; items: CompassupItem[];
  shipping_type: string; // 'seller' | 'platform'
  weight_before: number;
  services: { good_type: string; transport: string };
  certificate_type?: string; certificate_code?: string;
  track?: { code: string; label?: string; carrier: string };
};

/** POST /orders → trả { orderId, state, raw }. */
export async function createCompassupOrder(c: CompassupCred, inp: CompassupOrderInput): Promise<{ orderId: string; state: string; raw: unknown }> {
  const body = { username: c.username ?? c.tenant, order_type: "dropship", ...inp };
  // Với POST, ký theo TOÀN BỘ body (đã gồm items) — nếu server báo sai, đổi sang {} hoặc query.
  const r = await fetch(`${base(c)}/orders`, { method: "POST", headers: headers(c, body as Record<string, unknown>), body: JSON.stringify(body), ...ft() });
  const j = (await r.json().catch(() => ({}))) as Envelope<Record<string, unknown>>;
  if (!r.ok || j.success === false) {
    throw new Error(`Compassup create order HTTP ${r.status}: ${String(j.msg ?? "")}`.trim());
  }
  const d = (j.data ?? {}) as Record<string, unknown>;
  const orderId = String(d.id ?? "");
  if (!orderId) throw new Error("Compassup: không nhận được order id");
  return { orderId, state: String(d.state ?? "new"), raw: j };
}

// ---- Chi phí: mảng fees[] → cộng dồn ----
export type CompassupFee = { name: string; name_translate: string; value: string; description: string | null };
export function sumCompassupFees(raw: unknown): { total: number; fees: CompassupFee[]; estimate: boolean } {
  const j = (raw ?? {}) as Envelope<{ fees?: CompassupFee[] }>;
  const fees = (j.data?.fees ?? []) as CompassupFee[];
  let total = 0; let estimate = false;
  for (const f of fees) {
    const n = Number(f.value); if (!isNaN(n)) total += n;
    if (/estimate/i.test(f.description ?? "")) estimate = true;
  }
  return { total: Math.round(total * 100) / 100, fees, estimate };
}

/** GET /orders/fees?order_id= → chi phí (Estimate cho tới khi Compassup chốt). */
export async function getCompassupFees(c: CompassupCred, orderId: string): Promise<{ total: number; fees: CompassupFee[]; estimate: boolean; raw: unknown }> {
  const params = { order_id: orderId };
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${base(c)}/orders/fees?${qs}`, { headers: headers(c, params), ...ft() });
  const raw = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Compassup fees HTTP ${r.status}`);
  return { ...sumCompassupFees(raw), raw };
}

// ---- Tracking: batch tối đa 20 order_ids ----
export type CompassupTrack = { orderId?: string; code: string; carrier: string; createdAt?: string };
export function extractCompassupTracks(raw: unknown): CompassupTrack[] {
  const j = (raw ?? {}) as Envelope<Record<string, unknown>>;
  const d = (j.data ?? {}) as Record<string, unknown>;
  // Doc schema ghi "track" (object) nhưng example là "tracks" (array) → dò cả hai.
  const arr = (Array.isArray(d.tracks) ? d.tracks
    : Array.isArray(d.track) ? d.track
    : d.track && typeof d.track === "object" ? [d.track]
    : []) as Record<string, unknown>[];
  return arr.map((t) => ({
    orderId: t.order_id ? String(t.order_id) : undefined,
    code: String(t.code ?? ""),
    carrier: String(t.carrier ?? t.carrie ?? ""), // doc example gõ nhầm "carrie"
    createdAt: t.created_at ? String(t.created_at) : undefined,
  })).filter((t) => t.code);
}

/** GET /orders/track?order_ids=a,b,c (≤20). */
export async function getCompassupTracking(c: CompassupCred, orderIds: string[]): Promise<{ tracks: CompassupTrack[]; raw: unknown }> {
  const params = { order_ids: orderIds.slice(0, 20).join(",") };
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${base(c)}/orders/track?${qs}`, { headers: headers(c, params), ...ft() });
  const raw = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Compassup track HTTP ${r.status}`);
  return { tracks: extractCompassupTracks(raw), raw };
}

// ---- Product detail (import mapping từ link) ----
export type CompassupSku = { sku_id: string; label: string; image: string | null; attribute: string };
export type CompassupProduct = {
  pid: string; productId: string; title: string; titleTrans: string;
  images: string[]; skus: CompassupSku[]; marketplace: string; productType: string;
  shopId: string; sellerId: string; supSite: string; raw: unknown;
};

export function parseCompassupProduct(raw: unknown): CompassupProduct | null {
  const j = (raw ?? {}) as Envelope<{ product?: Record<string, unknown> }>;
  const p = j.data?.product;
  if (!p) return null;
  const skusRaw = (Array.isArray(p.skus) ? p.skus : []) as Record<string, unknown>[];
  const skus: CompassupSku[] = skusRaw.map((s) => {
    const attrs = (Array.isArray(s.attributes) ? s.attributes : []) as Record<string, unknown>[];
    // "Color: black; Shoe Size: 0" — dùng làm field `attribute` khi tạo đơn
    const label = attrs.map((a) => `${a.attribute_trans ?? a.attribute_name}: ${a.value_trans ?? a.value}`).join("; ");
    const img = attrs.map((a) => a.sku_image).find((x) => x) as string | undefined;
    return { sku_id: String(s.sku_id ?? ""), label, image: img ?? null, attribute: label };
  });
  // marketplace → sup_site khi tạo đơn (b2c_global / b2b_cn …). seller_id lấy từ shop_id.
  const marketplace = String(p.marketplace ?? "");
  return {
    pid: String(p.pid ?? ""), productId: String(p.product_id ?? ""),
    title: String(p.title ?? ""), titleTrans: String(p.title_trans ?? p.title ?? ""),
    images: (Array.isArray(p.images) ? p.images : []) as string[],
    skus, marketplace, productType: String(p.product_type ?? ""),
    shopId: String(p.shop_id ?? ""),
    sellerId: String((p.shop_info as Record<string, unknown>)?.shop_id ?? p.shop_id ?? ""),
    supSite: marketplace, raw: j,
  };
}

/** GET /product/detail?link= → chi tiết SP để tạo mapping. */
export async function getCompassupProduct(c: CompassupCred, link: string): Promise<CompassupProduct | null> {
  const params = { link };
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${base(c)}/product/detail?${qs}`, { headers: headers(c, params), ...ft() });
  const raw = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Compassup product detail HTTP ${r.status}`);
  return parseCompassupProduct(raw);
}
