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
