// ===== Printway Open API v3 =====
// Docs: https://documenter.getpostman.com/view/23929425/2sBXwqrVwZ
// - Base: https://apis.printway.io/v3  (UAT: https://uat.printway.work/api/v3)
// - Auth: header "pw-access-token: <ACCESS_TOKEN>" (token hạn 730 ngày, lấy ở Store → Connect APIs)
// - Rate limit: 50 req / 3s

const PW_API = "https://apis.printway.io/v3";

type Cred = { accessToken: string; endpoint?: string | null };

function headers(c: Cred) {
  // Doc dùng "pw-access-token"; vài endpoint (paid/cancel/delete) ghi "pw_access_toke" (typo trong doc)
  // và mọi endpoint đều nhận Bearer → gửi cả 3 cho chắc.
  return {
    "pw-access-token": c.accessToken,
    "pw_access_toke": c.accessToken,
    "Authorization": `Bearer ${c.accessToken}`,
    "Content-Type": "application/json",
  } as Record<string, string>;
}
// Signal tạo MỚI mỗi lần gọi — signal module-level sẽ hết hạn sau 25s làm mọi call sau abort ngay
const ft = () => ({ signal: AbortSignal.timeout(25000) });
const base = (c: Cred) => (c.endpoint && c.endpoint.trim() ? c.endpoint.trim().replace(/\/+$/, "") : PW_API);

// Đủ 16 vị trí artwork theo doc create-new-order (URL lấy từ list of products / R2 của FUSION)
export type PwOrderItem = {
  item_sku?: string;      // required nếu không có variant_id
  variant_id?: string;    // required nếu không có item_sku
  quantity: number;
  product_name?: string;
  product_location?: string; // vd "PW"
  made_in_location?: string; // vd "VN"
  variant_note?: string;
  mockup_url?: string;
  artwork_front?: string;
  artwork_back?: string;
  artwork_right?: string;
  artwork_left?: string;
  artwork_hood?: string;
  artwork_bothsides?: string;
  artwork_right_upper_sleeves?: string;
  artwork_right_lower_sleeves?: string;
  artwork_left_upper_sleeves?: string;
  artwork_left_lower_sleeves?: string;
  artwork_left_chest?: string;
  artwork_right_chest?: string;
  artwork_front_bottom_right?: string;
  artwork_center_upper_back?: string;
  artwork_across_chest?: string;
  artwork_across_back?: string;
};

export type PwCreateOrder = {
  order_id: string;
  store_code?: string;
  // CHỈ gửi với đơn TikTok — Printway coi sự hiện diện của field này = đơn TikTok
  // (TikTok chỉ ship US). Đơn Etsy/khác PHẢI bỏ hẳn field.
  tiktok_order_type?: "seller" | "tiktok";
  tiktok_label_url?: string; // bắt buộc khi tiktok_order_type = "tiktok"
  firstName: string;
  lastName: string;
  shipping_email?: string;   // RFC 5322
  shipping_phone?: string;   // E.164
  shipping_address1: string;
  shipping_address2?: string;
  shipping_city: string;
  shipping_province: string;
  shipping_province_code: string;
  shipping_zip: string;
  shipping_country: string;
  shipping_country_code: string;
  shipping_service?: string;
  discount_code?: string[];
  taxNumber?: string;
  order_items: PwOrderItem[];
};

// Tạo đơn: POST /order/create-new-order
export async function createPrintwayOrder(c: Cred, payload: PwCreateOrder): Promise<{ orderId: string; raw: unknown }> {
  const r = await fetch(`${base(c)}/order/create-new-order`, {
    method: "POST",
    headers: headers(c),
    body: JSON.stringify(payload),
    ...ft(),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const ok = r.ok && (j.success === undefined || j.success === true) && (j.status === undefined || Number(j.status) < 400 || j.status === "success");
  if (!ok) {
    const msg = (j.message as string) || (j.error as string) || JSON.stringify(j).slice(0, 200) || `HTTP ${r.status}`;
    throw new Error(`Printway create order failed: ${msg}`);
  }
  // Response tuỳ phiên bản có thể trả id/order_id trong data — đọc phòng thủ; fallback = order_id mình gửi (Printway nhận diện đơn theo order_id của seller).
  const d = (j.data ?? j) as Record<string, unknown>;
  const orderId = String(d.pw_order_id ?? d.order_id ?? d.id ?? d.order_code ?? payload.order_id);
  return { orderId, raw: j };
}

// Danh sách đơn: GET /transaction/order-list (lọc theo thời gian tạo / order_name / pw_order_id)
export type PwListParams = { createdMin?: Date; createdMax?: Date; page?: number; limit?: number; orderName?: string; pwOrderId?: string };
export async function listPrintwayOrders(c: Cred, p: PwListParams = {}): Promise<{ items: Record<string, unknown>[]; raw: unknown }> {
  const q = new URLSearchParams({
    created_at_min: (p.createdMin ?? new Date(Date.now() - 30 * 86400e3)).toISOString().slice(0, 23),
    created_at_max: (p.createdMax ?? new Date()).toISOString().slice(0, 23),
    limit: String(p.limit ?? 50),
    page: String(p.page ?? 1),
    pw_order_id: p.pwOrderId ?? "",
    order_name: p.orderName ?? "",
  });
  const r = await fetch(`${base(c)}/transaction/order-list?${q}`, { headers: headers(c), ...ft() });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`Printway order-list failed: HTTP ${r.status} ${(j.message as string) ?? ""}`.trim());
  return { items: extractArray(j), raw: j };
}

// Bóc mảng phòng thủ: data có thể là mảng, hoặc { orders/list/items/data/results/rows/catalogs/skus/products: [] } (lồng 2 tầng)
export function extractArray(j: unknown): Record<string, unknown>[] {
  const KEYS = ["orders", "list", "items", "data", "results", "rows", "catalogs", "skus", "products", "docs"];
  const dig = (v: unknown, depth: number): Record<string, unknown>[] | null => {
    if (Array.isArray(v)) return v as Record<string, unknown>[];
    if (v && typeof v === "object" && depth < 3) {
      const o = v as Record<string, unknown>;
      for (const k of KEYS) { if (k in o) { const got = dig(o[k], depth + 1); if (got) return got; } }
    }
    return null;
  };
  return dig(j, 0) ?? [];
}

// ---- Catalog SKU: GET /products/list-sku-catalogs ----
// Doc không nêu params → thử phân trang ?page&limit, nếu server bỏ qua thì tự dừng khi trùng dữ liệu.
export async function listPrintwaySkuCatalogs(c: Cred, page = 1, limit = 100): Promise<{ items: Record<string, unknown>[]; raw: unknown }> {
  const r = await fetch(`${base(c)}/products/list-sku-catalogs?page=${page}&limit=${limit}`, { headers: headers(c), ...ft() });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`Printway list-sku-catalogs failed: HTTP ${r.status} ${(j.message as string) ?? ""}`.trim());
  return { items: extractArray(j), raw: j };
}

// Chuẩn hoá số phòng thủ: nhận number, chuỗi "$4.50", hoặc object { amount/value/usd/price }
export function pwNum(v: unknown): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  if (typeof v === "string") { const n = Number(v.replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["amount", "value", "usd", "price"]) if (o[k] !== undefined) return pwNum(o[k]);
  }
  return 0;
}

export type PwSkuRow = { sku: string; variantId: string; product: string; variant: string; cost: number; ship: number };

const pickS = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) { const v = o[k]; if (typeof v === "string" && v) return v; if (typeof v === "number") return String(v); }
  return "";
};
const pickCost = (o: Record<string, unknown>) => {
  for (const k of ["base_cost", "base_price", "seller_price", "price_us", "price_usd", "us_price", "price", "cost", "amount", "sale_price", "base"]) {
    if (o[k] !== undefined && o[k] !== null && o[k] !== "") { const n = pwNum(o[k]); if (n > 0) return n; }
  }
  return 0;
};
const pickShip = (o: Record<string, unknown>) => {
  for (const k of ["ship_cost", "shipping_cost", "shipping_fee", "ship_fee", "ship_price", "shipping_price"]) {
    if (o[k] !== undefined && o[k] !== null && o[k] !== "") { const n = pwNum(o[k]); if (n > 0) return n; }
  }
  return 0;
};

function pwRowOf(o: Record<string, unknown>, productName: string): PwSkuRow {
  const sku = pickS(o, "item_sku", "sku", "sku_code", "skuCode", "code");
  const variantId = pickS(o, "variant_id", "variantId", "id", "_id");
  const size = pickS(o, "size", "size_name"); const color = pickS(o, "color", "color_name");
  // Cấu trúc thật: variant lồng trong product có { sku, title: "ORANGE/2XL/BACK", variant_id }
  // → "title" là tên variant KHI ở trong product (productName có sẵn); ở dòng phẳng "title" là tên sản phẩm.
  const variant = pickS(o, "variant_name", "variant_title", "variant", "option", "option_name")
    || (productName ? pickS(o, "title") : "")
    || [color, size].filter(Boolean).join(" / ");
  const product = productName || pickS(o, "product_name", "product_title", "productName", "title", "name", "product");
  return { sku, variantId, product, variant, cost: pickCost(o), ship: pickShip(o) };
}

// 1 item catalog có thể là DÒNG PHẲNG (variant sẵn) hoặc PRODUCT chứa mảng variants lồng bên trong
// → đào các key mảng con; không có thì đọc phẳng như cũ.
export function flattenPwCatalogItem(it: Record<string, unknown>): PwSkuRow[] {
  const product = pickS(it, "product_name", "product_title", "productName", "title", "name", "product");
  const VKEYS = ["variants", "variant", "skus", "sku_list", "list_variant", "list_variants", "list_sku", "options", "children", "sizes", "items", "data", "catalogs"];
  for (const k of VKEYS) {
    const v = it[k];
    if (Array.isArray(v) && v.length && v[0] && typeof v[0] === "object") {
      const rows = (v as Record<string, unknown>[]).map((s) => pwRowOf(s, product)).filter((r) => r.sku || r.variantId);
      if (rows.length) return rows;
    }
  }
  const r = pwRowOf(it, product);
  return r.sku || r.variantId ? [r] : [];
}

// Chuẩn hoá 1 dòng catalog → { sku, variantId, product, variant, cost, ship } (giữ cho tương thích cũ)
export function normalizePwSkuRow(it: Record<string, unknown>) {
  return pwRowOf(it, "");
}

// ---- Shipping methods: POST /products/retrieved-shipping-methods { variant_id: [], sku: [] } ----
export async function getPrintwayShippingMethods(c: Cred, p: { variantIds?: string[]; skus?: string[] }): Promise<{ items: Record<string, unknown>[]; raw: unknown }> {
  const r = await fetch(`${base(c)}/products/retrieved-shipping-methods`, {
    method: "POST",
    headers: headers(c),
    body: JSON.stringify({ variant_id: p.variantIds ?? [], sku: p.skus ?? [] }),
    ...ft(),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`Printway shipping-methods failed: HTTP ${r.status} ${(j.message as string) ?? ""}`.trim());
  return { items: extractArray(j), raw: j };
}

// ---- Webhook: POST /webhooks?type=order|tracking { access_key, access_token, endpoint } ----
// Printway sẽ gọi endpoint của mình kèm header <access_key>: <access_token>.
// access_key chỉ được chứa a-z A-Z 0-9 - _ ; access_token thêm được _ :;.,\/"'\''?!(){}[]@<>=-+*#$&`|~^%
export type PwWebhookType = "order" | "tracking";
export async function registerPrintwayWebhook(c: Cred, type: PwWebhookType, p: { accessKey: string; accessToken: string; endpoint: string }): Promise<unknown> {
  const r = await fetch(`${base(c)}/webhooks?type=${type}`, {
    method: "POST",
    headers: headers(c),
    body: JSON.stringify({ access_key: p.accessKey, access_token: p.accessToken, endpoint: p.endpoint }),
    ...ft(),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || j.success === false) throw new Error(`Printway register webhook(${type}) failed: HTTP ${r.status} ${(j.message as string) ?? JSON.stringify(j).slice(0, 160)}`.trim());
  return j;
}
export async function getPrintwayWebhooks(c: Cred, type: PwWebhookType): Promise<unknown> {
  const r = await fetch(`${base(c)}/webhooks?type=${type}`, { headers: headers(c), ...ft() });
  return (await r.json().catch(() => ({}))) as unknown;
}

// ---- Thanh toán đơn: POST /order/paid { order_id: <PW order id> } ----
// Printway tạo đơn xong ở trạng thái CHƯA THANH TOÁN — phải paid thì mới vào production.
export async function payPrintwayOrder(c: Cred, orderId: string): Promise<{ ok: boolean; message: string; raw: unknown }> {
  const r = await fetch(`${base(c)}/order/paid`, {
    method: "POST",
    headers: headers(c),
    body: JSON.stringify({ order_id: orderId }),
    ...ft(),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const ok = r.ok && j.success !== false && !(typeof j.status === "number" && j.status >= 400);
  const message = (j.message as string) || (j.error as string) || (ok ? "paid" : `HTTP ${r.status}`);
  return { ok, message, raw: j };
}

// ---- Huỷ đơn (chưa vào production): POST /order/cancel-order-api { pw_order_id?, order_name? } ----
export async function cancelPrintwayOrder(c: Cred, p: { pwOrderId?: string; orderName?: string }): Promise<{ ok: boolean; message: string }> {
  const body: Record<string, string> = {};
  if (p.pwOrderId) body.pw_order_id = p.pwOrderId;
  if (p.orderName) body.order_name = p.orderName;
  const r = await fetch(`${base(c)}/order/cancel-order-api`, { method: "POST", headers: headers(c), body: JSON.stringify(body), ...ft() });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok && j.success !== false, message: (j.message as string) || (j.error as string) || `HTTP ${r.status}` };
}

// ---- Xoá đơn (đang chờ + chưa trả tiền): POST /order/delete-order-api { pw_order_id?, order_name? } ----
export async function deletePrintwayOrder(c: Cred, p: { pwOrderId?: string; orderName?: string }): Promise<{ ok: boolean; message: string }> {
  const body: Record<string, string> = {};
  if (p.pwOrderId) body.pw_order_id = p.pwOrderId;
  if (p.orderName) body.order_name = p.orderName;
  const r = await fetch(`${base(c)}/order/delete-order-api`, { method: "POST", headers: headers(c), body: JSON.stringify(body), ...ft() });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok && j.success !== false, message: (j.message as string) || (j.error as string) || `HTTP ${r.status}` };
}

// Chuẩn hoá 1 đơn Printway → { orderName, status, tracking, carrier, trackingUrl } (dò field phòng thủ)
export function normalizePwOrder(it: Record<string, unknown>) {
  const S = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  const pick = (...keys: string[]) => { for (const k of keys) { const v = S(it[k]); if (v) return v; } return ""; };
  const orderName = pick("order_name", "order_id", "orderName", "external_id", "name");
  const pwId = pick("pw_order_id", "pwOrderId", "id", "code");
  const statusRaw = pick("status", "order_status", "fulfillment_status", "state").toLowerCase();
  const tracking = pick("tracking_number", "trackingNumber", "tracking_code", "tracking", "tracking_id");
  const carrier = pick("carrier", "shipping_carrier", "carrier_name", "logistics");
  const trackingUrl = pick("tracking_url", "trackingUrl", "tracking_link");
  return { orderName, pwId, statusRaw, ffStatus: mapPwStatus(statusRaw, !!tracking), tracking, carrier, trackingUrl };
}

// Map trạng thái Printway → trạng thái ffo của FUSION (dùng chung cho poll + webhook)
/** QUY TẮC CHUNG: Push → pushed · ĐÃ TRẢ TIỀN → in_production · CÓ TRACKING → shipped. */
export function mapPwStatus(statusRaw: string, hasTracking = false): string {
  const s = (statusRaw || "").toLowerCase();
  if (/cancel|refund|reject/.test(s)) return "cancelled";
  if (/deliver/.test(s)) return "delivered";
  // Bug cũ: /ship/ khớp "shipping", /fulfil/ khớp "fulfilling" → shipped khi chưa có tracking
  if (hasTracking || /shipped|in.?transit|transit|dispatch|picked|out.?for.?delivery/.test(s)) return "shipped";
  if (/production|process|printing|printed|pending|paid|confirm|hold|approv|fulfil/.test(s)) return "in_production";
  return "";
}

// ---- Tính giá: POST /order/calculate-price (doc không có response mẫu → parse phòng thủ) ----
export async function calcPrintwayPrice(
  c: Cred,
  p: { countryCode: string; provinceCode: string; service?: string; items: { item_sku?: string; variant_id?: string; quantity: number }[] },
): Promise<{ total: number; base: number; ship: number; raw: unknown }> {
  const r = await fetch(`${base(c)}/order/calculate-price`, {
    method: "POST",
    headers: headers(c),
    body: JSON.stringify({
      discount_code: [],
      shipping_country_code: p.countryCode,
      shipping_province_code: p.provinceCode,
      shipping_service: p.service ?? "",
      order_items: p.items,
    }),
    ...ft(),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || j.success === false) throw new Error(`Printway calculate-price failed: HTTP ${r.status} ${(j.message as string) ?? JSON.stringify(j).slice(0, 160)}`.trim());
  const d = (j.data && typeof j.data === "object" ? j.data : j) as Record<string, unknown>;
  const pickN = (o: Record<string, unknown>, ...keys: string[]) => { for (const k of keys) { if (o[k] !== undefined && o[k] !== null && o[k] !== "") { const n = pwNum(o[k]); if (n > 0) return n; } } return 0; };
  let base_ = pickN(d, "base_cost", "base_price", "product_price", "product_cost", "subtotal", "sub_total", "items_price");
  let ship_ = pickN(d, "ship_cost", "shipping_cost", "shipping_fee", "ship_fee", "shipping_price");
  let total = pickN(d, "total", "total_price", "total_cost", "grand_total", "amount", "price");
  // Nếu chỉ có tổng trong items lồng → cộng dồn
  if (!total && !base_) {
    const arr = extractArray(d);
    for (const it of arr) {
      base_ += pickN(it as Record<string, unknown>, "base_cost", "base_price", "price", "product_price", "amount");
      ship_ += pickN(it as Record<string, unknown>, "ship_cost", "shipping_cost", "shipping_fee");
    }
  }
  if (!total) total = base_ + ship_;
  if (total && !base_) base_ = total - ship_;
  return { total, base: base_, ship: ship_, raw: j };
}

// ---- Chi tiết đơn: GET /order/detail { pw_order_id | order_name } ----
// Doc mô tả là GET kèm body JSON — fetch() KHÔNG cho GET có body → thử GET query-string trước,
// không ra giá thì fallback POST body. Đây là NGUỒN GIÁ THẬT duy nhất: webhook Printway
// (type=order/tracking) không gửi tiền, /order/calculate-price lúc đẩy có thể fail/0.
export async function getPrintwayOrderDetail(c: Cred, p: { pwOrderId?: string; orderName?: string }): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams();
  if (p.pwOrderId) qs.set("pw_order_id", p.pwOrderId);
  if (p.orderName) qs.set("order_name", p.orderName);

  let j: Record<string, unknown> = {};
  try {
    const r = await fetch(`${base(c)}/order/detail?${qs}`, { headers: headers(c), ...ft() });
    j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.ok && j.success !== false && extractPwCost(j).found) return j;
  } catch { /* thử tiếp POST */ }

  const body: Record<string, string> = {};
  if (p.pwOrderId) body.pw_order_id = p.pwOrderId;
  if (p.orderName) body.order_name = p.orderName;
  const r2 = await fetch(`${base(c)}/order/detail`, { method: "POST", headers: headers(c), body: JSON.stringify(body), ...ft() });
  const j2 = (await r2.json().catch(() => ({}))) as Record<string, unknown>;
  if (r2.ok && j2.success !== false) return j2;
  return j;
}

// Bóc GIÁ từ 1 object đơn Printway (order/detail, order-list, transaction/order-list).
// Printway UI hiển thị: Product price / Shipping fee / Tax / Total → dò mọi biến thể tên field.
export type PwCost = { base: number; ship: number; tax: number; total: number; found: boolean };
export function extractPwCost(obj: Record<string, unknown>): PwCost {
  // /order/detail trả { success, message, data: [ {...} ] } → data là MẢNG, phải lấy phần tử đầu.
  const d0: unknown = obj.data !== undefined ? obj.data : obj;
  const d = (Array.isArray(d0) ? (d0[0] ?? {}) : d0) as Record<string, unknown>;

  const pickN = (o: Record<string, unknown>, ...keys: string[]) => {
    for (const k of keys) {
      if (o[k] !== undefined && o[k] !== null && o[k] !== "") { const n = pwNum(o[k]); if (n > 0) return n; }
    }
    return 0;
  };
  // Tên field THẬT của Printway (xác nhận từ response): base_fee / shipping_fee / tax_fee / total_price.
  // Các tên khác giữ lại làm dự phòng nếu Printway đổi schema.
  let base = pickN(d, "base_fee", "base_cost", "product_price", "base_price", "product_cost", "product_amount", "subtotal", "sub_total", "items_price");
  let ship = pickN(d, "shipping_fee", "ship_cost", "shipping_cost", "ship_fee", "shipping_price", "shipping_amount");
  let tax = pickN(d, "tax_fee", "tax", "tax_cost", "tax_amount", "taxes", "tax_price");
  let total = pickN(d, "total_price", "total", "total_cost", "grand_total", "total_amount", "amount");
  const surcharge = pickN(d, "surcharge");

  // Không có ở cấp đơn → cộng dồn từ dòng hàng (Printway đặt tên "orderitems")
  if (!base && !ship) {
    const arr = ((Array.isArray(d.orderitems) ? d.orderitems
      : Array.isArray(d.order_items) ? d.order_items
      : Array.isArray(d.items) ? d.items : []) as Record<string, unknown>[]);
    for (const it of arr) {
      base += pickN(it, "base_cost", "base_fee", "product_price", "base_price", "price", "product_cost");
      ship += pickN(it, "shipping_cost", "shipping_fee", "ship_cost", "ship_fee");
      tax += pickN(it, "tax_cost", "tax_fee", "tax", "tax_amount");
    }
  }
  if (!total) total = base + ship + tax + surcharge;
  if (total && !base) base = Math.max(0, total - ship - tax - surcharge);
  const r2 = (n: number) => Math.round(n * 100) / 100; // giữ đúng tới cent
  return { base: r2(base), ship: r2(ship), tax: r2(tax + surcharge), total: r2(total), found: total > 0 };
}
