/**
 * Merchize API client — https://seller.merchize.com (bo-api)
 * Base URL dạng: https://{group}.merchize.com/{store}/bo-api  (lưu ở fulfillers.api_endpoint)
 * 2 kiểu auth:
 *   - REST chính (orders/products):        Authorization: Bearer {accessToken}
 *   - Endpoint /order/external/...:         x-api-key: {apiKey}
 */

const clean = (base: string) => base.replace(/\/+$/, "");

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
export function extractMerchizeCatalog(data: unknown): { sku: string; title: string; cost: number }[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const nested = (d.data ?? {}) as Record<string, unknown>;
  const arr = (Array.isArray(data) ? data
    : Array.isArray(d.data) ? d.data
    : Array.isArray(d.products) ? d.products
    : Array.isArray(d.items) ? d.items
    : Array.isArray(nested.items) ? nested.items
    : Array.isArray(nested.products) ? nested.products
    : []) as Record<string, unknown>[];
  const out: { sku: string; title: string; cost: number }[] = [];
  const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return isNaN(n) ? 0 : n; };
  for (const p of Array.isArray(arr) ? arr : []) {
    const title = String(p.title ?? p.name ?? p.product_title ?? "");
    const variants = (p.variants ?? p.varioptions ?? p.options ?? null) as Record<string, unknown>[] | null;
    if (Array.isArray(variants) && variants.length) {
      for (const v of variants) {
        const sku = String(v.sku ?? v.code ?? v.variant_sku ?? "").trim();
        if (sku) out.push({ sku, title: `${title}${v.title ? " · " + v.title : ""}`.trim(), cost: num(v.cost ?? v.base_cost ?? v.price) });
      }
    } else {
      const sku = String(p.sku ?? p.code ?? p.product_sku ?? "").trim();
      if (sku) out.push({ sku, title, cost: num(p.cost ?? p.base_cost ?? p.price) });
    }
  }
  return out;
}
