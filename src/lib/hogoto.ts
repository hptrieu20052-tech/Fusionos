/**
 * HOGOTO POD — Partner API (https://seller.hogotopod.com/api).
 * Xác thực bằng header X-API-Key + X-Tenant (mặc định "fulfillment").
 * Đẩy đơn: POST /v1/partner/order/store.
 * Doc mẫu 2026-07 (cURL order/store).
 */

export type HogotoCfg = { endpoint: string; apiKey: string; tenant: string };
export type HogotoResult = { orderCode: string; baseCost?: number; shipCost?: number; raw: unknown };

const num = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

/** Ghép URL: endpoint có thể là ".../api" hoặc gốc → luôn ra ".../api/v1/partner/...". */
function apiUrl(endpoint: string, path: string): string {
  let base = (endpoint || "https://seller.hogotopod.com/api").replace(/\/+$/, "");
  if (!/\/api$/i.test(base)) base += "/api";
  return base + path;
}

export async function createHogotoOrder(cfg: HogotoCfg, body: unknown): Promise<HogotoResult> {
  const res = await fetch(apiUrl(cfg.endpoint, "/v1/partner/order/store"), {
    method: "POST",
    headers: { "X-API-Key": cfg.apiKey, "X-Tenant": cfg.tenant || "fulfillment", "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let j: Record<string, unknown> = {};
  try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  if (!res.ok) {
    const msg = (typeof j.message === "string" && j.message) || (typeof j.error === "string" && j.error) || text.slice(0, 400);
    throw new Error(`Hogoto HTTP ${res.status}: ${msg}`);
  }
  // Response: bọc trong data{} hoặc phẳng — bóc orderCode ở nhiều tên khả dĩ.
  const data = (j.data && typeof j.data === "object" ? j.data : j) as Record<string, unknown>;
  const orderCode = String(
    data.orderCode ?? data.code ?? data.order_code ?? data.referenceCode ??
    (typeof data.order === "object" && data.order ? (data.order as Record<string, unknown>).orderCode : "") ?? "",
  );
  const baseCost = num(data.baseCost ?? data.productAmount ?? data.itemsAmount ?? data.itemAmount);
  const shipCost = num(data.shippingFee ?? data.shippingAmount ?? data.shipping_fee);
  return { orderCode: orderCode || `HGT-${res.status}`, baseCost, shipCost, raw: j };
}

// ===== KÉO CATALOG (GET /v1/product) → dựng SKU mapping =====
export type HogotoRow = {
  productCode: string; name: string; sku: string; size: string;
  positionCode: string | null; productType: string | null; baseCost: number; shipCost: number;
};

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const asArray = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

/** Bóc mảng sản phẩm ở nhiều kiểu bọc: data / data.content / content / mảng phẳng. */
function pickProducts(j: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(j)) return j as Record<string, unknown>[];
  const d = j.data as Record<string, unknown> | undefined;
  if (Array.isArray(d)) return d as unknown as Record<string, unknown>[];
  if (d && Array.isArray(d.content)) return d.content as Record<string, unknown>[];
  if (Array.isArray(j.content)) return j.content as Record<string, unknown>[];
  if (d && Array.isArray(d.items)) return d.items as Record<string, unknown>[];
  return [];
}

export async function listHogotoProducts(cfg: HogotoCfg): Promise<{ rows: HogotoRow[]; sample: unknown; count: number }> {
  const res = await fetch(apiUrl(cfg.endpoint, "/v1/product"), {
    headers: { "X-API-Key": cfg.apiKey, "X-Tenant": cfg.tenant || "fulfillment", Accept: "application/json" },
  });
  const text = await res.text();
  let j: Record<string, unknown> = {};
  try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  if (!res.ok) {
    const msg = (typeof j.message === "string" && j.message) || text.slice(0, 300);
    throw new Error(`Hogoto GET /v1/product HTTP ${res.status}: ${msg}`);
  }
  const products = pickProducts(j);
  const rows: HogotoRow[] = [];
  for (const p of products) {
    const productCode = str(p.productCode ?? p.code ?? p.product_code);
    if (!productCode) continue;
    const name = str(p.name ?? p.title ?? p.productName);
    const positionCode = str(p.positionCode ?? p.printPosition ?? p.print_position ?? p.printLocation) || null;
    const productType = str(p.productType ?? p.type ?? p.product_type) || null;
    const variations = asArray(p.variations ?? p.variants ?? p.skus ?? p.variationList ?? p.sizes);
    if (variations.length) {
      for (const v of variations) {
        const size = str(v.size ?? v.sizeName ?? v.variantName ?? v.name);
        const sku = str(v.sku ?? v.skuCode ?? v.code) || `${productCode}_${size}`;
        const baseCost = num(v.baseCost ?? v.basePrice ?? v.price ?? v.cost) ?? 0;
        const shipCost = num(v.shippingFee ?? v.shipCost ?? v.shipByTiktokUs ?? v.shipping) ?? 0;
        rows.push({ productCode, name, sku, size, positionCode, productType, baseCost, shipCost });
      }
    } else {
      rows.push({ productCode, name, sku: str(p.sku) || productCode, size: "", positionCode, productType, baseCost: 0, shipCost: 0 });
    }
  }
  return { rows, sample: products[0] ?? j, count: products.length };
}
