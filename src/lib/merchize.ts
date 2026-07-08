/**
 * Merchize API client — https://seller.merchize.com (bo-api)
 * Base URL dạng: https://{group}.merchize.com/{store}/bo-api  (lưu ở fulfillers.api_endpoint)
 * 2 kiểu auth:
 *   - REST chính (orders/products):        Authorization: Bearer {accessToken}
 *   - Endpoint /order/external/...:         x-api-key: {apiKey}
 */

const clean = (base: string) => base.replace(/\/+$/, "");

/** Push (confirm) đơn Merchize đi sản xuất. POST /order/external/orders/push (x-api-key). */
export async function pushMerchizeOrder(
  baseUrl: string, apiKey: string,
  order: { code?: string; external_number?: string; identifier?: string },
): Promise<unknown> {
  const url = `${clean(baseUrl)}/order/external/orders/push`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Merchize push HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/** GET tracking đơn Merchize. Dùng x-api-key. Trả nguyên JSON (dò field khi dùng). */
export async function getMerchizeTracking(
  baseUrl: string, apiKey: string,
  params: { code?: string; externalNumber?: string; identifier?: string },
): Promise<unknown> {
  const qs = params.code
    ? `code=${encodeURIComponent(params.code)}`
    : `external_number=${encodeURIComponent(params.externalNumber ?? "")}&identifier=${encodeURIComponent(params.identifier ?? "")}`;
  const url = `${clean(baseUrl)}/order/external/orders/tracking?${qs}`;
  const res = await fetch(url, { headers: { "x-api-key": apiKey, "Content-Type": "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Merchize tracking HTTP ${res.status}: ${text.slice(0, 250)}`);
  return text ? JSON.parse(text) : {};
}

/** Rút tracking number/url/carrier từ response Merchize (dò nhiều tên field cho chắc). */
export function extractMerchizeTracking(data: unknown): { trackingNumber?: string; trackingUrl?: string; carrier?: string; status?: string } {
  const d = (data as Record<string, unknown>) ?? {};
  const r = (d.data ?? d.resource ?? d) as Record<string, unknown>;
  const g = (...names: string[]) => { for (const n of names) { const v = r?.[n]; if (v) return String(v); } return undefined; };
  return {
    trackingNumber: g("tracking_number", "tracking_code", "trackingNumber", "code"),
    trackingUrl: g("tracking_url", "trackingUrl"),
    carrier: g("shipping_carrier", "carrier", "tracking_company", "shipping_company"),
    status: g("status", "fulfillment_status", "order_status"),
  };
}

export type MerchizeItem = {
  product_id?: number | string; sku?: string; merchize_sku: string;
  quantity: number; price?: number; currency?: string; printing_method?: string;
  image?: string; design_front?: string; design_back?: string; design_sleeve?: string; design_hood?: string;
};
export type MerchizeOrderPayload = {
  order_id: string; identifier: string;
  shipping_info: { full_name: string; address_1: string; address_2?: string; city: string; state?: string; postcode: string; country: string; email?: string; phone?: string };
  tags?: string[]; tax?: string; items: MerchizeItem[];
};

/** Tạo đơn Merchize từ catalog. POST /order/external/orders/catalog (x-api-key). */
export async function createMerchizeOrder(baseUrl: string, apiKey: string, payload: MerchizeOrderPayload): Promise<{ orderCode: string; raw: unknown }> {
  const url = `${clean(baseUrl)}/order/external/orders/catalog`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Merchize create HTTP ${res.status}: ${text.slice(0, 400)}`);
  const data = text ? JSON.parse(text) : {};
  // Merchize trả { success, data: { _id, status, data: {...} } }. success=false → coi như lỗi.
  if (data && data.success === false) {
    throw new Error(`Merchize từ chối đơn: ${JSON.stringify(data.message ?? data.error ?? data).slice(0, 400)}`);
  }
  const inner = (data.data ?? data.resource ?? data) as Record<string, unknown>;
  const orderCode = String(inner?._id ?? inner?.order_code ?? inner?.code ?? inner?.id ?? data?.order_code ?? "");
  return { orderCode, raw: data };
}

/** GET tất cả variant của 1 product Merchize (x-api-key). */
export async function getMerchizeVariants(baseUrl: string, apiKey: string, productId: string): Promise<unknown> {
  const url = `${clean(baseUrl)}/product/products/${encodeURIComponent(productId)}/all-variants`;
  const res = await fetch(url, { headers: { "x-api-key": apiKey, "Content-Type": "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Merchize variants HTTP ${res.status}: ${text.slice(0, 250)}`);
  return text ? JSON.parse(text) : {};
}

/** Rút {sku,title,cost} từ response all-variants. Merchize: { success, data:[{_id, sku, title, product, options, retail_price}] }. */
export function extractMerchizeVariants(data: unknown): { sku: string; title: string; cost: number; variantId?: string; retail?: number }[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const nested = (d.data ?? {}) as Record<string, unknown>;
  const arr = (Array.isArray(data) ? data
    : Array.isArray(d.data) ? d.data
    : Array.isArray(d.variants) ? d.variants
    : Array.isArray(nested.variants) ? nested.variants
    : Array.isArray(d.items) ? d.items
    : []) as Record<string, unknown>[];
  const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return isNaN(n) ? 0 : n; };
  const out: { sku: string; title: string; cost: number; variantId?: string; retail?: number }[] = [];
  for (const v of Array.isArray(arr) ? arr : []) {
    const variantId = String(v._id ?? v.id ?? "").trim();
    // SKU: dùng sku nếu có; Merchize hay để trống → fallback sang _id để vẫn định danh được
    const sku = (String(v.sku ?? v.merchize_sku ?? "").trim()) || variantId;
    if (!sku) continue;
    // Title màu/size: thử nhiều dạng field Merchize hay dùng
    const attrArr = (Array.isArray(v.options) ? v.options
      : Array.isArray(v.attributes) ? v.attributes
      : Array.isArray(v.variant_options) ? v.variant_options
      : Array.isArray(v.option_values) ? v.option_values
      : []) as Record<string, unknown>[];
    const optStr = attrArr.map((o) => String(o?.value ?? o?.name ?? o?.title ?? o?.option ?? "")).filter(Boolean).join(" / ");
    const opt123 = [v.option1, v.option2, v.option3].map((x) => String(x ?? "").trim()).filter(Boolean).join(" / ");
    const title = String(v.title ?? v.variant_title ?? v.name ?? "").trim() || optStr || opt123;
    // Không có fulfill cost trong response → 0 (người dùng tự điền / hoặc cập nhật sau)
    const cost = num(v.cost ?? v.base_cost ?? v.fulfill_cost ?? 0);
    out.push({ sku, title, cost, variantId, retail: num(v.retail_price) });
  }
  return out;
}

/** Rút danh sách product {productId, title} từ catalog (để gọi all-variants cho từng cái). */
export function extractMerchizeProducts(data: unknown): { productId: string; title: string }[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const nested = (d.data ?? {}) as Record<string, unknown>;
  const arr = (Array.isArray(data) ? data
    : Array.isArray(d.data) ? d.data
    : Array.isArray(d.products) ? d.products
    : Array.isArray(d.items) ? d.items
    : Array.isArray(nested.items) ? nested.items
    : Array.isArray(nested.products) ? nested.products
    : []) as Record<string, unknown>[];
  const out: { productId: string; title: string }[] = [];
  for (const p of Array.isArray(arr) ? arr : []) {
    const pid = p.product_id ?? p.id ?? p._id;
    if (pid == null) continue;
    out.push({ productId: String(pid), title: String(p.title ?? p.name ?? "") });
  }
  return out;
}

/** GET catalog sản phẩm Merchize (x-api-key). search = danh sách SKU ngăn cách dấu phẩy (tùy chọn). */
export async function getMerchizeCatalog(
  baseUrl: string, apiKey: string,
  opts: { limit?: number; page?: number; search?: string } = {},
): Promise<unknown> {
  const p = new URLSearchParams();
  p.set("limit", String(opts.limit ?? 50));
  p.set("page", String(opts.page ?? 1));
  if (opts.search) p.set("search", opts.search);
  const url = `${clean(baseUrl)}/product/catalog?${p.toString()}`;
  const res = await fetch(url, { headers: { "x-api-key": apiKey, "Content-Type": "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Merchize catalog HTTP ${res.status}: ${text.slice(0, 250)}`);
  return text ? JSON.parse(text) : {};
}

/** Rút danh sách {sku,title,cost} từ response catalog (dò nhiều dạng cấu trúc). */
export function extractMerchizeCatalog(data: unknown): { sku: string; title: string; cost: number; productId?: string }[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const nested = (d.data ?? {}) as Record<string, unknown>;
  const arr = (Array.isArray(data) ? data
    : Array.isArray(d.data) ? d.data
    : Array.isArray(d.products) ? d.products
    : Array.isArray(d.items) ? d.items
    : Array.isArray(nested.items) ? nested.items
    : Array.isArray(nested.products) ? nested.products
    : []) as Record<string, unknown>[];
  const out: { sku: string; title: string; cost: number; productId?: string }[] = [];
  const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return isNaN(n) ? 0 : n; };
  for (const p of Array.isArray(arr) ? arr : []) {
    const title = String(p.title ?? p.name ?? p.product_title ?? "");
    const pid = p.product_id ?? p.id ?? p._id;
    const productId = pid != null ? String(pid) : undefined;
    const variants = (p.variants ?? p.varioptions ?? p.options ?? null) as Record<string, unknown>[] | null;
    if (Array.isArray(variants) && variants.length) {
      for (const v of variants) {
        const sku = String(v.sku ?? v.code ?? v.variant_sku ?? "").trim();
        if (sku) out.push({ sku, title: `${title}${v.title ? " · " + v.title : ""}`.trim(), cost: num(v.cost ?? v.base_cost ?? v.price), productId });
      }
    } else {
      const sku = String(p.sku ?? p.code ?? p.product_sku ?? "").trim();
      if (sku) out.push({ sku, title, cost: num(p.cost ?? p.base_cost ?? p.price), productId });
    }
  }
  return out;
}
