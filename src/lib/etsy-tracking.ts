// Đơn SPLIT (Duplicate/Split) mang external_id dạng "<id>-CLONE-n" — khi gọi API sàn phải dùng mã đơn THẬT.
const platformExtId = (ext: string) => ext.replace(/-CLONE-\d+$/, "");
import { db, schema } from "@/lib/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getValidCfg, createReceiptShipment, etsyCarrier } from "@/lib/etsy";

export type PushResult = { ok: boolean; pushed: number; skipped: number; errors: string[]; reason?: string };

// Đẩy tracking của 1 đơn Etsy ngược lên Etsy qua API.
// Dùng cho: nút bấm tay + tự động sau khi webhook fulfiller trả tracking.
// best-effort: nếu store chưa nối API / không phải Etsy → trả reason, không ném lỗi.
export async function pushEtsyTrackingForOrder(orderId: string, opts: { sendBcc?: boolean } = {}): Promise<PushResult> {
  const [order] = await db.select({
    id: schema.orders.id, platform: schema.orders.platform, externalId: schema.orders.externalId, storeId: schema.orders.storeId,
  }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order) return { ok: false, pushed: 0, skipped: 0, errors: [], reason: "order not found" };
  if (order.platform !== "etsy") return { ok: false, pushed: 0, skipped: 0, errors: [], reason: "not an Etsy order" };
  if (!order.storeId) return { ok: false, pushed: 0, skipped: 0, errors: [], reason: "order has no store" };

  const [store] = await db.select({ c: schema.stores.apiCredentials }).from(schema.stores).where(eq(schema.stores.id, order.storeId)).limit(1);
  const cred = (store?.c ?? {}) as Record<string, string>;
  if (!cred.etsy_refresh_token || !cred.etsy_shop_id) return { ok: false, pushed: 0, skipped: 0, errors: [], reason: "store not connected to Etsy API" };

  // Các bản ghi fulfill có tracking mà CHƯA đẩy lên Etsy
  const ffos = await db.select({
    id: schema.fulfillmentOrders.id,
    tracking: schema.fulfillmentOrders.trackingNumber,
    carrier: schema.fulfillmentOrders.trackingCarrier,
  }).from(schema.fulfillmentOrders).where(and(
    eq(schema.fulfillmentOrders.orderId, order.id),
    isNotNull(schema.fulfillmentOrders.trackingNumber),
    isNull(schema.fulfillmentOrders.etsyTrackingPushedAt),
  ));
  if (!ffos.length) return { ok: true, pushed: 0, skipped: 0, errors: [], reason: "no new tracking to push" };

  let cfg;
  try { cfg = await getValidCfg(order.storeId, cred); }
  catch (e) { return { ok: false, pushed: 0, skipped: 0, errors: [String((e as Error)?.message ?? e)], reason: "token error" }; }

  let pushed = 0, skipped = 0;
  const errors: string[] = [];
  const doneCodes = new Set<string>();
  for (const f of ffos) {
    const code = (f.tracking || "").trim();
    if (!code) { skipped++; continue; }
    try {
      // Tránh gửi trùng cùng 1 mã tracking trong 1 lần chạy
      if (!doneCodes.has(code)) {
        await createReceiptShipment(cfg, platformExtId(order.externalId), { trackingCode: code, carrierName: etsyCarrier(f.carrier), sendBcc: opts.sendBcc });
        doneCodes.add(code);
        pushed++;
      } else skipped++;
      await db.update(schema.fulfillmentOrders).set({ etsyTrackingPushedAt: new Date() }).where(eq(schema.fulfillmentOrders.id, f.id));
    } catch (e) {
      errors.push(`${code}: ${String((e as Error)?.message ?? e).slice(0, 140)}`);
    }
  }
  return { ok: errors.length === 0, pushed, skipped, errors };
}

// Gọi an toàn từ webhook (không làm hỏng luồng webhook nếu Etsy lỗi).
export async function autoPushEtsyTracking(orderId: string) {
  try { return await pushEtsyTrackingForOrder(orderId, { sendBcc: true }); }
  catch { return null; }
}
