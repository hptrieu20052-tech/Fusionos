import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, or } from "drizzle-orm";
import { syncOrderFromFf, markShippedOnTracking } from "@/lib/order-status";
import { autoPushEtsyTracking } from "@/lib/etsy-tracking";
import { mapFsStatus } from "@/lib/flashship";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/flashship — nhận webhook từ FlashShip.
 * Headers: x-signature = HmacSHA256(payload_json, webhook_secret) · type = order:created |
 * order:status:updated | order:shipment:created | order:shipment:status | order:payment:pending.
 * Body: { type, created_at, resource: { partner_order_id, order_code, status, payment_status,
 * tracking_status, tracking_number, quantity, total_fee } }.
 * Khớp đơn theo order_code (external_ff_id) hoặc partner_order_id (orders.external_id/order_label).
 * Phải trả 200 nhanh — FlashShip retry 4 lần/5 phút, fail liên tục sẽ bị tắt webhook 1 giờ.
 */
export async function POST(req: NextRequest) {
  const sig = (req.headers.get("x-signature") || "").trim().toLowerCase();
  const rawBody = await req.text();
  let b: Record<string, unknown> | null = null;
  try { b = JSON.parse(rawBody); } catch { /* giữ null */ }
  if (!b) return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });

  const S = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  const r = (b.resource && typeof b.resource === "object" ? (b.resource as Record<string, unknown>) : b);
  const orderCode = S(r.order_code);
  const partnerOrderId = S(r.partner_order_id);
  if (!orderCode && !partnerOrderId) return NextResponse.json({ ok: false, error: "missing order_code/partner_order_id" }, { status: 400 });

  // ---- Tìm fulfillment order: external_ff_id = order_code; else theo partner_order_id → orders ----
  const ids = [orderCode, partnerOrderId].filter(Boolean);
  let ffo = (await db.select().from(schema.fulfillmentOrders)
    .where(or(...ids.map((v) => eq(schema.fulfillmentOrders.externalFfId, v)))).limit(1))[0];
  if (!ffo && partnerOrderId) {
    const [ord] = await db.select().from(schema.orders)
      .where(or(eq(schema.orders.externalId, partnerOrderId), eq(schema.orders.orderLabel, partnerOrderId))).limit(1);
    if (ord) ffo = (await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.orderId, ord.id)).limit(1))[0];
  }
  if (!ffo) return NextResponse.json({ ok: false, error: "no matching order found" }, { status: 404 });

  // ---- Xác thực chữ ký theo nhà fulfill của đơn ----
  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, ffo.fulfillerId)).limit(1);
  if (!ff?.webhookSecret) return NextResponse.json({ ok: false, error: "no webhook secret configured" }, { status: 401 });
  const h = crypto.createHmac("sha256", ff.webhookSecret).update(rawBody);
  const expectHex = h.digest("hex").toLowerCase();
  const expectB64 = crypto.createHmac("sha256", ff.webhookSecret).update(rawBody).digest("base64").toLowerCase();
  if (sig !== expectHex && sig !== expectB64) {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }

  // ---- Bóc dữ liệu ----
  const status = S(r.status);
  const trackingStatus = S(r.tracking_status);
  const tracking = S(r.tracking_number);
  const carrier = S(r.shipping_carrier) || S(r.carrier);
  const totalFee = Number(r.total_fee);
  const paymentStatus = S(r.payment_status);
  const evType = S(b.type) || (req.headers.get("type") ?? "");
  const ffStatus = mapFsStatus(status, trackingStatus, !!tracking);

  // ---- Cập nhật ----
  const patch: Record<string, unknown> = {};
  if (ffStatus && ffStatus !== ffo.status) patch.status = ffStatus;
  if (tracking && tracking !== ffo.trackingNumber) {
    patch.trackingNumber = tracking;
    patch.trackingCarrier = carrier || null;
    patch.trackingSyncedAt = new Date();
  }
  if (!isNaN(totalFee) && totalFee > 0 && !ffo.cost) patch.cost = totalFee.toFixed(2);
  if (status.toUpperCase() === "HOLD") patch.errorMessage = `HOLD${S(r.reject_note) ? `: ${S(r.reject_note)}` : " — check design/address on FlashShip"}`.slice(0, 500);
  if (/payment:pending/.test(evType) || paymentStatus.toUpperCase() === "PENDING") {
    patch.errorMessage = "Payment PENDING — repay on FlashShip web admin".slice(0, 500);
  }

  if (Object.keys(patch).length) {
    await db.update(schema.fulfillmentOrders).set(patch).where(eq(schema.fulfillmentOrders.id, ffo.id));
    if (ffStatus) await syncOrderFromFf(ffo.orderId, ffStatus);
    if (patch.trackingNumber) {
      await markShippedOnTracking(ffo.orderId);
      await autoPushEtsyTracking(ffo.orderId);
    }
  }
  return NextResponse.json({ ok: true, matched: ffo.id, event: evType, applied: Object.keys(patch) });
}
