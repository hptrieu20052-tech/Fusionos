// Đơn SPLIT (Duplicate/Split) mang external_id dạng "<id>-CLONE-n" — gọi API TikTok phải dùng mã đơn THẬT.
const platformExtId = (ext: string) => ext.replace(/-CLONE-\d+$/, "");
import { db, schema } from "@/lib/db";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { ttGetValidCfg, ttGetOrderDetail, ttShipPackage, ttShippingType } from "@/lib/tiktok-shop";

export type TtPushResult = { ok: boolean; pushed: number; errors: string[]; reason?: string };

/**
 * Ghi nhận LẦN TRƯỢT: lưu lý do + tăng số lần thử + hẹn giờ thử lại (5' → 10' → 20' … tối đa 6h).
 * Không có cái này, đơn hỏng vĩnh viễn bị quét lại mỗi vòng cron và ăn hết ngân sách 50s của sweep.
 */
async function stampFail(orderId: string, why: string) {
  try {
    await db.execute(sql`
      UPDATE fulfillment_orders
      SET tiktok_push_error = ${why.slice(0, 300)},
          tiktok_push_attempts = tiktok_push_attempts + 1,
          tiktok_push_next_at = now() + make_interval(mins => least(360, (5 * power(2, least(tiktok_push_attempts, 7)))::int))
      WHERE order_id = ${orderId}
        AND tracking_number IS NOT NULL
        AND tiktok_tracking_pushed_at IS NULL
    `);
  } catch { /* ghi log lỗi mà lỗi tiếp thì thôi, không làm hỏng luồng */ }
}

/**
 * Đẩy tracking của 1 đơn TikTok SELLER-SHIPPING lên TikTok (mark shipped).
 * CHỈ đơn shipping_type = SELLER (đơn TikTok-shipping thì TikTok tự có tracking, không đẩy).
 * best-effort: lỗi thì KHÔNG đánh dấu pushed → vòng cron sau thử lại; không ném lỗi ra ngoài.
 */
export async function pushTiktokTrackingForOrder(orderId: string): Promise<TtPushResult> {
  const fail = async (reason: string, errors: string[] = []): Promise<TtPushResult> => {
    await stampFail(orderId, errors[0] ?? reason);
    return { ok: false, pushed: 0, errors, reason };
  };

  const [order] = await db.select({
    id: schema.orders.id, platform: schema.orders.platform, externalId: schema.orders.externalId,
    storeId: schema.orders.storeId, shippingType: schema.orders.shippingType,
  }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order) return { ok: false, pushed: 0, errors: [], reason: "order not found" };
  if (order.platform !== "tiktok") return fail("not a TikTok order");
  if (order.shippingType === "TIKTOK") return fail("TikTok Shipping (has its own tracking)");
  if (!order.storeId) return fail("order has no store");
  // TỰ CHỮA: đơn cũ lưu shipping_type NULL/lạ (do bug `??` với chuỗi rỗng) thì KHÔNG bỏ qua nữa —
  // hỏi thẳng TikTok Order Detail để biết chắc, rồi ghi lại vào DB. Vẫn tuyệt đối không đẩy nhầm
  // đơn TikTok-Shipping: chỉ đi tiếp khi TikTok xác nhận là SELLER.
  let shipType = order.shippingType;
  let detail: Record<string, unknown> | undefined;
  let cfg0: Awaited<ReturnType<typeof ttGetValidCfg>> | undefined;
  const [store0] = await db.select({ c: schema.stores.apiCredentials }).from(schema.stores).where(eq(schema.stores.id, order.storeId)).limit(1);
  if (shipType !== "SELLER") {
    try {
      cfg0 = await ttGetValidCfg(order.storeId, (store0?.c ?? null) as Record<string, string> | null);
      detail = (await ttGetOrderDetail(cfg0, [platformExtId(order.externalId)]))[0] as Record<string, unknown> | undefined;
    } catch (e) { return fail("token/order detail error", [String((e as Error)?.message ?? e)]); }
    const resolved = detail ? ttShippingType(detail) : undefined;
    if (resolved && resolved !== order.shippingType) {
      await db.update(schema.orders).set({ shippingType: resolved }).where(eq(schema.orders.id, order.id));
    }
    shipType = resolved ?? null;
    if (shipType !== "SELLER") {
      return fail(`not Seller Shipping (TikTok says shipping_type=${shipType ?? "empty"})`);
    }
  }

  // Các bản ghi fulfill có tracking mà CHƯA đẩy lên TikTok
  const ffos = await db.select({
    id: schema.fulfillmentOrders.id, tracking: schema.fulfillmentOrders.trackingNumber,
  }).from(schema.fulfillmentOrders).where(and(
    eq(schema.fulfillmentOrders.orderId, order.id),
    isNotNull(schema.fulfillmentOrders.trackingNumber),
    isNull(schema.fulfillmentOrders.tiktokTrackingPushedAt),
  ));
  if (!ffos.length) return { ok: true, pushed: 0, errors: [], reason: "no new tracking to push" };

  let cfg = cfg0;
  if (!cfg) {
    try { cfg = await ttGetValidCfg(order.storeId, (store0?.c ?? null) as Record<string, string> | null); }
    catch (e) { return fail("token error", [String((e as Error)?.message ?? e)]); }
  }

  // Lấy line_item_ids + shipping_provider_id từ order detail (tái dùng bản đã lấy ở bước xác định shipping type)
  let lineItemIds: string[] = [], providerId = "";
  try {
    const d = detail ?? ((await ttGetOrderDetail(cfg, [platformExtId(order.externalId)]))[0] as Record<string, unknown> | undefined);
    lineItemIds = (((d?.line_items ?? []) as Record<string, unknown>[])).map((x) => String(x.id ?? "")).filter(Boolean);
    providerId = String(d?.shipping_provider_id ?? (d?.packages as Record<string, unknown>[] | undefined)?.[0]?.shipping_provider_id ?? "");
  } catch (e) { return fail("order detail error", [String((e as Error)?.message ?? e)]); }

  let pushed = 0;
  const errors: string[] = [];
  const done = new Set<string>();
  for (const f of ffos) {
    const code = (f.tracking || "").trim();
    if (!code) continue;
    try {
      if (!done.has(code)) {
        await ttShipPackage(cfg, { orderId: platformExtId(order.externalId), orderLineItemIds: lineItemIds, trackingNumber: code, providerId });
        done.add(code); pushed++;
      }
      await db.update(schema.fulfillmentOrders)
        .set({ tiktokTrackingPushedAt: new Date(), tiktokPushError: null, tiktokPushNextAt: null })
        .where(eq(schema.fulfillmentOrders.id, f.id));
    } catch (e) {
      errors.push(`${code}: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
    }
  }
  if (errors.length) await stampFail(orderId, errors[0]);
  return { ok: errors.length === 0, pushed, errors };
}

// Gọi an toàn từ webhook (không làm hỏng luồng webhook nếu TikTok lỗi).
// Tự bỏ qua đơn không phải TikTok Seller-Shipping (hàm trên đã guard), nên gọi vô tư ở mọi webhook tracking.
export async function autoPushTiktokTracking(orderId: string) {
  try { return await pushTiktokTrackingForOrder(orderId); }
  catch { return null; }
}
