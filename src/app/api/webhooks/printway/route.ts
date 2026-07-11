import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, or } from "drizzle-orm";
import { syncOrderFromFf, markShippedOnTracking } from "@/lib/order-status";
import { autoPushEtsyTracking } from "@/lib/etsy-tracking";
import { mapPwStatus } from "@/lib/printway-api";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/printway — nhận webhook từ Printway (type=order + type=tracking).
 * Khi đăng ký (POST /webhooks?type=...) FUSION đặt access_key = "x-fusion-webhook",
 * access_token = fulfillers.webhook_secret → Printway gọi kèm header "x-fusion-webhook: <secret>".
 * Payload (type order): { order_id, pw_order_id, order_items: [{ item_sku, order_status, message_error? }] }
 * Payload (type tracking): tương tự kèm tracking_number/carrier (dò field phòng thủ ở cả top-level lẫn items).
 * Khớp đơn theo external_ff_id ∈ {order_id, pw_order_id} hoặc orders.external_id/order_label = order_id.
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-fusion-webhook");
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });

  const S = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  const root = (b.data && typeof b.data === "object" ? (b.data as Record<string, unknown>) : b);
  const orderId = S(root.order_id ?? root.order_name ?? root.external_id);
  const pwOrderId = S(root.pw_order_id ?? root.pwOrderId);
  if (!orderId && !pwOrderId) return NextResponse.json({ ok: false, error: "missing order_id/pw_order_id" }, { status: 400 });

  // ---- Tìm fulfillment order: external_ff_id = order_id hoặc pw_order_id; else theo orders.external_id/order_label ----
  const ids = [orderId, pwOrderId].filter(Boolean);
  let ffo = (await db.select().from(schema.fulfillmentOrders)
    .where(or(...ids.map((v) => eq(schema.fulfillmentOrders.externalFfId, v)))).limit(1))[0];
  if (!ffo && orderId) {
    const [ord] = await db.select().from(schema.orders)
      .where(or(eq(schema.orders.externalId, orderId), eq(schema.orders.orderLabel, orderId))).limit(1);
    if (ord) ffo = (await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.orderId, ord.id)).limit(1))[0];
  }
  if (!ffo) return NextResponse.json({ ok: false, error: "no matching order found" }, { status: 404 });

  // ---- Xác thực secret theo nhà fulfill của đơn (phải là Printway và secret khớp) ----
  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, ffo.fulfillerId)).limit(1);
  if (!ff?.webhookSecret || key !== ff.webhookSecret) {
    return NextResponse.json({ ok: false, error: "sai webhook key" }, { status: 401 });
  }

  // ---- Bóc items + gom trạng thái / tracking (dò phòng thủ top-level lẫn từng item) ----
  const items = (Array.isArray(root.order_items) ? root.order_items : Array.isArray(root.items) ? root.items : []) as Record<string, unknown>[];
  const pick = (o: Record<string, unknown>, ...keys: string[]) => { for (const k of keys) { const v = S(o[k]); if (v) return v; } return ""; };

  let statusRaw = pick(root, "order_status", "status", "state");
  let tracking = pick(root, "tracking_number", "trackingNumber", "tracking_code", "tracking", "tracking_id");
  let carrier = pick(root, "carrier_name", "carrier", "carrier_code", "shipping_carrier", "logistics");
  let trackingUrl = pick(root, "tracking_url", "trackingUrl", "tracking_link");
  let errMsg = pick(root, "message_error", "error_message", "message");
  for (const it of items) {
    if (!statusRaw) statusRaw = pick(it, "order_status", "status", "state");
    if (!tracking) tracking = pick(it, "tracking_number", "trackingNumber", "tracking_code", "tracking", "tracking_id");
    if (!carrier) carrier = pick(it, "carrier_name", "carrier", "carrier_code", "shipping_carrier", "logistics");
    if (!trackingUrl) trackingUrl = pick(it, "tracking_url", "trackingUrl", "tracking_link");
    if (!errMsg) errMsg = pick(it, "message_error", "error_message");
  }
  const ffStatus = mapPwStatus(statusRaw, !!tracking);

  // ---- Cập nhật ----
  const patch: Record<string, unknown> = {};
  if (pwOrderId && ffo.externalFfId !== pwOrderId && ffo.externalFfId === orderId) patch.externalFfId = pwOrderId; // nâng cấp id nội bộ Printway khi biết
  if (ffStatus && ffStatus !== ffo.status) patch.status = ffStatus;
  if (tracking && tracking !== ffo.trackingNumber) {
    patch.trackingNumber = tracking;
    patch.trackingCarrier = carrier || null;
    patch.trackingUrl = trackingUrl || null;
    patch.trackingSyncedAt = new Date();
  }
  if (errMsg) patch.errorMessage = errMsg.slice(0, 500); // Printway chỉ gửi message_error khi có vấn đề thật

  if (Object.keys(patch).length) {
    await db.update(schema.fulfillmentOrders).set(patch).where(eq(schema.fulfillmentOrders.id, ffo.id));
    if (ffStatus) await syncOrderFromFf(ffo.orderId, ffStatus);
    if (patch.trackingNumber) {
      await markShippedOnTracking(ffo.orderId);
      await autoPushEtsyTracking(ffo.orderId);
    }
  }
  return NextResponse.json({ ok: true, matched: ffo.id, applied: Object.keys(patch) });
}
