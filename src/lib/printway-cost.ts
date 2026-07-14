import { db, schema } from "@/lib/db";
import { and, eq, like } from "drizzle-orm";
import { getPrintwayOrderDetail, extractPwCost } from "@/lib/printway-api";

type Cred = { accessToken: string; endpoint?: string | null };
type FfoLite = { id: string; orderId: string; externalFfId: string | null; cost?: string | null };

/**
 * Kéo GIÁ THẬT của 1 đơn Printway về FUSION.
 *
 * Vì sao cần: webhook Printway (type=order/tracking) KHÔNG gửi tiền, và /order/calculate-price
 * lúc đẩy thường trả 0 (đơn chưa thanh toán → chưa chốt phí ship/tax). Giá chỉ chốt sau khi
 * đơn được PAID bên Printway → phải gọi /order/detail để lấy Product price + Shipping fee + Tax.
 *
 * Ghi: fulfillment_orders (base/ship/extra/cost) + sửa bút toán base_cost (âm) cho khớp.
 * Trả true nếu lấy được giá > 0.
 */
export async function syncPrintwayCost(cred: Cred, ffo: FfoLite): Promise<boolean> {
  const [ord] = await db.select({ label: schema.orders.orderLabel, ext: schema.orders.externalId })
    .from(schema.orders).where(eq(schema.orders.id, ffo.orderId)).limit(1);
  // order_name = đúng chuỗi FUSION gửi lúc tạo đơn (orderLabel nếu có, else externalId)
  const orderName = (ord?.label?.trim() || ord?.ext || "") || undefined;
  // pw_order_id do Printway cấp, dạng PWN…/PW… (webhook nâng cấp externalFfId sang mã này)
  const pwOrderId = ffo.externalFfId && /^PW/i.test(ffo.externalFfId) ? ffo.externalFfId : undefined;
  if (!pwOrderId && !orderName) return false;

  const detail = await getPrintwayOrderDetail(cred, { pwOrderId, orderName });
  const c = extractPwCost(detail);
  if (!c.found) return false;

  await db.update(schema.fulfillmentOrders).set({
    baseCost: c.base.toFixed(2), shipCost: c.ship.toFixed(2),
    extraFee: c.tax.toFixed(2), cost: c.total.toFixed(2),
  }).where(eq(schema.fulfillmentOrders.id, ffo.id));

  // Bút toán base_cost = -(total). Note lúc đẩy có chứa external_ff_id; nếu id đã bị
  // nâng cấp (order_name → PWN…) thì không khớp nữa → fallback theo orderId.
  const amount = (-c.total).toFixed(2);
  let hit: { id: string }[] = [];
  if (ffo.externalFfId) {
    hit = await db.update(schema.transactions).set({ amount }).where(and(
      eq(schema.transactions.orderId, ffo.orderId),
      eq(schema.transactions.type, "base_cost"),
      like(schema.transactions.note, `%${ffo.externalFfId}%`),
    )).returning({ id: schema.transactions.id });
  }
  if (!hit.length) {
    await db.update(schema.transactions).set({ amount }).where(and(
      eq(schema.transactions.orderId, ffo.orderId),
      eq(schema.transactions.type, "base_cost"),
    ));
  }
  return true;
}

/** Có phải fulfiller Printway không (dùng chung cho webhook/poll). */
export const isPrintwayFf = (name: string) => name.toLowerCase().includes("printway");

/** Lấy access token từ credentials của fulfiller. */
export function pwCredOf(ff: { apiEndpoint: string | null; credentials: unknown }): Cred | null {
  const c = (ff.credentials ?? {}) as Record<string, unknown>;
  const token = (c.apiKey || c.accessToken || c.apiToken) as string | undefined;
  return token ? { accessToken: token, endpoint: ff.apiEndpoint } : null;
}
