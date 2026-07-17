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

/**
 * Rút tracking / status / CHI PHÍ từ response /orders/tracking của Merchize.
 *
 * Cấu trúc thật (xác nhận từ response):
 *   { success, data: [ { status, shipping_cost, tracking_number, tracking_company, tracking_url,
 *                        items: [ { fulfillment_cost, fulfilled_quantity, ffm_mapped_catalog_sku,
 *                                   captured_catalogs: { SKU: { tax: { US: 0.5 } } } } ] } ] }
 *
 * Bẫy đã gặp:
 *  - `data` là MẢNG SHIPMENT (RE-xxxxx-F1, -F2…) → phải CỘNG DỒN, không lấy phần tử đầu.
 *  - Import tax KHÔNG có ở cấp đơn: nằm trong captured_catalogs[SKU].tax[<country>].
 *    Merchize UI gọi là "US Import Tax/item" và tính = tax/item × quantity.
 *  - KHÔNG fallback tracking sang `code`/`name` — đó là mã đơn/shipment, không phải mã vận đơn.
 */
export function extractMerchizeTracking(data: unknown, countryCode = "US"): {
  trackingNumber?: string; trackingUrl?: string; carrier?: string; status?: string;
  fulfillmentCost?: number; shippingCost?: number; importTax?: number;
} {
  const d = (data as Record<string, unknown>) ?? {};
  const rawArr: unknown = d.data ?? d.resource ?? d;
  const arr = (Array.isArray(rawArr) ? rawArr : [rawArr]) as Record<string, unknown>[];
  const N = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };
  const S = (v: unknown) => (v === undefined || v === null || v === "" ? "" : String(v));
  const cc = (countryCode || "US").toUpperCase();

  let trackingNumber = "", trackingUrl = "", carrier = "", status = "";
  let base = 0, ship = 0, tax = 0, sawCost = false;

  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    if (!trackingNumber) {
      trackingNumber = S(e.tracking_number ?? e.tracking_code);
      trackingUrl = S(e.tracking_url);
      carrier = S(e.tracking_company ?? e.shipping_carrier ?? e.carrier ?? e.carrier_code);
    }
    if (!status) status = S(e.status ?? e.fulfillment_status ?? e.order_status);
    ship += N(e.shipping_cost ?? e.shipping_fee);

    const items = (Array.isArray(e.items) ? e.items : Array.isArray(e.order_items) ? e.order_items : []) as Record<string, unknown>[];
    for (const it of items) {
      const c = N(it.fulfillment_cost ?? it.base_cost);
      if (c > 0) { base += c; sawCost = true; }
      const qty = N(it.fulfilled_quantity ?? it.quantity) || 1;
      // Import tax của ĐÚNG nước giao hàng, lấy từ catalog đã capture lúc tạo đơn
      const caps = (it.captured_catalogs ?? {}) as Record<string, Record<string, unknown>>;
      for (const cat of Object.values(caps)) {
        const tmap = (cat?.tax ?? {}) as Record<string, unknown>;
        const t = N(tmap[cc]);
        if (t > 0) { tax += t * qty; break; }
      }
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100; // giữ đúng tới cent
  return {
    trackingNumber: trackingNumber || undefined,
    trackingUrl: trackingUrl || undefined,
    carrier: carrier || undefined,
    status: status || undefined,
    fulfillmentCost: sawCost ? r2(base) : undefined,
    shippingCost: r2(ship),
    importTax: r2(tax),
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
  // PHẢI ưu tiên `code` (RM-xxxxx-xxxxx) — đó là mã endpoint /orders/tracking nhận.
  // Bug cũ: lấy `_id` (Mongo ObjectId) trước → mọi lần poll tracking đều trả "Order not found".
  const nested = (inner?.data && typeof inner.data === "object" ? inner.data : {}) as Record<string, unknown>;
  const orderCode = String(
    inner?.code ?? inner?.order_code ?? nested?.code ?? nested?.order_code ??
    inner?._id ?? inner?.id ?? data?.order_code ?? "",
  );
  return { orderCode, raw: data };
}

export type MerchizeTiktokPayload = {
  order_id: string; identifier: string;
  shipping_info: { shipping_provider: string; shipping_label: string; merchize_warehouse: string; tracking_number: string };
  tags?: string[]; items: MerchizeItem[];
};

/**
 * Tạo đơn TIKTOK SHIPPING trên Merchize — POST /order/external/tiktok-shipping/orders/catalog (x-api-key).
 * Đơn "Ship by TikTok" đã có label + tracking của TikTok → Merchize chỉ in & dán nhãn,
 * KHÔNG cần địa chỉ khách (địa chỉ bị TikTok che sao, đẩy qua endpoint external sẽ bị từ chối).
 */
export async function createMerchizeTiktokOrder(baseUrl: string, apiKey: string, payload: MerchizeTiktokPayload): Promise<{ orderCode: string; raw: unknown }> {
  const url = `${clean(baseUrl)}/order/external/tiktok-shipping/orders/catalog`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Merchize TikTok-Shipping create HTTP ${res.status}: ${text.slice(0, 400)}`);
  const data = text ? JSON.parse(text) : {};
  if (data && data.success === false) {
    throw new Error(`Merchize từ chối đơn TikTok: ${JSON.stringify(data.message ?? data.error ?? data).slice(0, 400)}`);
  }
  const inner = (data.data ?? data.resource ?? data) as Record<string, unknown>;
  const nested = (inner?.data && typeof inner.data === "object" ? inner.data : {}) as Record<string, unknown>;
  const orderCode = String(
    inner?.code ?? inner?.order_code ?? nested?.code ?? nested?.order_code ??
    inner?._id ?? inner?.id ?? data?.order_code ?? "",
  );
  return { orderCode, raw: data };
}

/**
 * Lấy tracking đơn Merchize — TỰ ĐỘNG FALLBACK.
 *
 * Endpoint /orders/tracking nhận `code` (RM-xxxxx-xxxxx), KHÔNG nhận Mongo `_id`.
 * Đơn đẩy trước bản vá lưu nhầm `_id` → gọi bằng code sẽ "Order not found".
 * → Thử `code` trước; hỏng thì hỏi lại bằng `external_number` + `identifier`
 *   (chính là chuỗi FUSION gửi lúc tạo đơn), luôn khớp dù lưu id kiểu gì.
 */
export async function getMerchizeTrackingSmart(
  baseUrl: string, apiKey: string,
  p: { code?: string; externalNumber?: string; identifier?: string },
): Promise<{ raw: unknown; via: "code" | "external_number" | "none" }> {
  const notFound = (r: unknown) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return o.success === false || /not found/i.test(String(o.message ?? ""));
  };
  if (p.code) {
    try {
      const raw = await getMerchizeTracking(baseUrl, apiKey, { code: p.code });
      if (!notFound(raw)) return { raw, via: "code" };
    } catch { /* thử cách 2 */ }
  }
  if (p.externalNumber && p.identifier) {
    try {
      const raw = await getMerchizeTracking(baseUrl, apiKey, { externalNumber: p.externalNumber, identifier: p.identifier });
      if (!notFound(raw)) return { raw, via: "external_number" };
      return { raw, via: "none" };
    } catch { /* rơi xuống dưới */ }
  }
  return { raw: { success: false, message: "Order not found (đã thử cả code và external_number)" }, via: "none" };
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

/** Lấy mảng products từ response catalog (dạng { data: { products: [...] } } hoặc phẳng). */
export function extractCatalogProducts(data: unknown): Record<string, unknown>[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const nested = (d.data ?? {}) as Record<string, unknown>;
  const arr = (Array.isArray(nested.products) ? nested.products
    : Array.isArray(d.products) ? d.products
    : Array.isArray(d.data) ? d.data
    : Array.isArray(data) ? data
    : []) as Record<string, unknown>[];
  return Array.isArray(arr) ? arr : [];
}

/** Rút danh sách variant (sku + nhãn màu/size + base tier1 + ship US) từ 1 product trong catalog. */
export function catalogVariantsOf(product: Record<string, unknown>): { sku: string; title: string; productId: string; variant: string; base: number; ship: number }[] {
  const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };
  const title = String(product.title ?? product.name ?? "").trim();
  const productId = String(product._id ?? product.id ?? "");
  const variants = (Array.isArray(product.variants) ? product.variants : []) as Record<string, unknown>[];
  const out: { sku: string; title: string; productId: string; variant: string; base: number; ship: number }[] = [];
  for (const v of variants) {
    const sku = String(v.sku ?? "").trim();
    if (!sku) continue;
    // Nhãn màu/size từ attributes[]: {name/type, value_text}. Color trước, Size sau, còn lại nối tiếp.
    const attrs = (Array.isArray(v.attributes) ? v.attributes : []) as Record<string, unknown>[];
    const key = (a: Record<string, unknown>) => String(a.type ?? a.name ?? "").toLowerCase();
    const txt = (a: Record<string, unknown>) => String(a.value_text ?? a.value ?? a.name ?? "").trim();
    const color = attrs.find((a) => /colou?r/.test(key(a)));
    const size = attrs.find((a) => /size/.test(key(a)));
    const others = attrs.filter((a) => a !== color && a !== size).map(txt).filter(Boolean);
    const variant = [color ? txt(color) : "", size ? txt(size) : "", ...others].filter(Boolean).join(" / ");
    // Base = giá tier1 (mặc định); Ship = first_item của zone US
    const tiers = (Array.isArray(v.tiers) ? v.tiers : []) as Record<string, unknown>[];
    const t1 = tiers.find((t) => t.name === "tier1") ?? tiers[0];
    const base = num(t1?.price);
    const ships = (Array.isArray(v.shipping_prices) ? v.shipping_prices : []) as Record<string, unknown>[];
    const us = ships.find((s) => String(s.to_zone ?? "").toUpperCase() === "US") ?? ships[0];
    const ship = num(us?.first_item);
    out.push({ sku, title, productId, variant, base, ship });
  }
  return out;
}

/** Rút danh sách {sku,title,cost,ship,variant,productId} từ response catalog (đọc cả variant + màu/size + giá). */
export function extractMerchizeCatalog(data: unknown): { sku: string; title: string; cost: number; ship?: number; variant?: string; productId?: string }[] {
  const products = extractCatalogProducts(data);
  const out: { sku: string; title: string; cost: number; ship?: number; variant?: string; productId?: string }[] = [];
  for (const p of products) {
    const vs = catalogVariantsOf(p);
    if (vs.length) {
      for (const r of vs) out.push({ sku: r.sku, title: r.title, cost: r.base, ship: r.ship, variant: r.variant, productId: r.productId });
    } else {
      // Fallback: product không có variants[] → 1 dòng theo product sku
      const sku = String(p.sku ?? "").trim();
      if (sku) out.push({ sku, title: String(p.title ?? p.name ?? ""), cost: 0, productId: String(p._id ?? p.id ?? "") || undefined });
    }
  }
  return out;
}
