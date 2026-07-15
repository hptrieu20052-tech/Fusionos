import { db, schema } from "@/lib/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { ttGetValidCfg, ttGetOrderDetail, ttShipPackage } from "@/lib/tiktok-shop";

export type TtPushResult = { ok: boolean; pushed: number; errors: string[]; reason?: string };

/**
 * Đẩy tracking của 1 đơn TikTok SELLER-SHIPPING lên TikTok (mark shipped).
 * CHỈ đơn shipping_type = SELLER (đơn TikTok-shipping thì TikTok tự có tracking, không đẩy).
 * best-effort: lỗi thì KHÔNG đánh dấu pushed → vòng cron sau thử lại; không ném lỗi ra ngoài.
 */
export async function pushTiktokTrackingForOrder(orderId: string): Promise<TtPushResult> {
  const [order] = await db.select({
    id: schema.orders.id, platform: schema.orders.platform, externalId: schema.orders.externalId,
    storeId: schema.orders.storeId, shippingType: schema.orders.shippingType,
  }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order) return { ok: false, pushed: 0, errors: [], reason: "order not found" };
  if (order.platform !== "tiktok") return { ok: false, pushed: 0, errors: [], reason: "not a TikTok order" };
  if (order.shippingType !== "SELLER") return { ok: false, pushed: 0, errors: [], reason: "not Seller Shipping (TikTok Shipping has its own tracking)" };
  if (!order.storeId) return { ok: false, pushed: 0, errors: [], reason: "order has no store" };

  // Các bản ghi fulfill có tracking mà CHƯA đẩy lên TikTok
  const ffos = await db.select({
    id: schema.fulfillmentOrders.id, tracking: schema.fulfillmentOrders.trackingNumber,
  }).from(schema.fulfillmentOrders).where(and(
    eq(schema.fulfillmentOrders.orderId, order.id),
    isNotNull(schema.fulfillmentOrders.trackingNumber),
    isNull(schema.fulfillmentOrders.tiktokTrackingPushedAt),
  ));
  if (!ffos.length) return { ok: true, pushed: 0, errors: [], reason: "no new tracking to push" };

  const [store] = await db.select({ c: schema.stores.apiCredentials }).from(schema.stores).where(eq(schema.stores.id, order.storeId)).limit(1);
  let cfg;
  try { cfg = await ttGetValidCfg(order.storeId, (store?.c ?? null) as Record<string, string> | null); }
  catch (e) { return { ok: false, pushed: 0, errors: [String((e as Error)?.message ?? e)], reason: "token error" }; }

  // Lấy line_item_ids + shipping_provider_id từ order detail
  let lineItemIds: string[] = [], providerId = "";
  try {
    const orders = await ttGetOrderDetail(cfg, [order.externalId]);
    const d = orders[0] as Record<string, unknown> | undefined;
    lineItemIds = (((d?.line_items ?? []) as Record<string, unknown>[])).map((x) => String(x.id ?? "")).filter(Boolean);
    providerId = String(d?.shipping_provider_id ?? "");
  } catch (e) { return { ok: false, pushed: 0, errors: [String((e as Error)?.message ?? e)], reason: "order detail error" }; }

  let pushed = 0;
  const errors: string[] = [];
  const done = new Set<string>();
  for (const f of ffos) {
    const code = (f.tracking || "").trim();
    if (!code) continue;
    try {
      if (!done.has(code)) {
        await ttShipPackage(cfg, { orderId: order.externalId, orderLineItemIds: lineItemIds, trackingNumber: code, providerId });
        done.add(code); pushed++;
      }
      await db.update(schema.fulfillmentOrders).set({ tiktokTrackingPushedAt: new Date() }).where(eq(schema.fulfillmentOrders.id, f.id));
    } catch (e) {
      errors.push(`${code}: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
    }
  }
  return { ok: errors.length === 0, pushed, errors };
}
