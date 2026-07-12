import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { autoPushEtsyTracking } from "@/lib/etsy-tracking";
import { syncOrderFromFf, refundOrderCost, markShippedOnTracking } from "@/lib/order-status";
import { verifyWembroiderySignature, mapWemStatus } from "@/lib/wembroidery";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/wembroidery — nhận webhook Wembroidery.
 * Payload: { webhookId, sentAt, data: { orderId, externalId, trackingNumber?, carrierCode?, trackingUrl?,
 *            status?, addressVerified?, hookType: "update_tracking" | "update_order_status" } }
 * Ký HMAC-SHA256 (stringToSign = timestamp + payload) — secret dán vào fulfillers.webhook_secret,
 * PHẢI trùng secret cấu hình webhook trên seller.wembroidery.com.
 * Khớp đơn theo orderId (external_ff_id) hoặc externalId (sellerOrderId = orderLabel/externalId FUSION).
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let b: Record<string, unknown> | null = null;
  try { b = JSON.parse(rawBody) as Record<string, unknown>; } catch { /* giữ null */ }
  if (!b) return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });

  const d = (b.data && typeof b.data === "object" ? (b.data as Record<string, unknown>) : b);
  const S = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  const wemId = S(d.orderId ?? d.order_id ?? d.id);
  const extNumber = S(d.externalId ?? d.external_id ?? d.sellerOrderId);
  if (!wemId && !extNumber) return NextResponse.json({ ok: false, error: "missing order identifiers" }, { status: 400 });

  // Tìm fulfillment order: ưu tiên orderId Wembroidery (= external_ff_id), else theo sellerOrderId
  let ffo = wemId
    ? (await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.externalFfId, wemId)).limit(1))[0]
    : undefined;
  if (!ffo && extNumber) {
    const [ord] = await db.select().from(schema.orders)
      .where(or(eq(schema.orders.externalId, extNumber), eq(schema.orders.orderLabel, extNumber))).limit(1);
    if (ord) ffo = (await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.orderId, ord.id)).limit(1))[0];
  }
  if (!ffo && extNumber) {
    ffo = (await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.externalFfId, extNumber)).limit(1))[0];
  }
  if (!ffo) return NextResponse.json({ ok: false, error: "no matching order found" }, { status: 404 });

  // Xác thực chữ ký theo secret của nhà Wembroidery
  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, ffo.fulfillerId)).limit(1);
  if (!ff?.webhookSecret) return NextResponse.json({ ok: false, error: "webhook secret not configured — set it in fulfiller settings (must match seller.wembroidery.com)" }, { status: 401 });
  const signature = req.headers.get("x-webhook-signature") ?? req.headers.get("x-signature") ?? req.headers.get("signature");
  const timestamp = req.headers.get("x-webhook-timestamp") ?? req.headers.get("x-timestamp");
  if (!verifyWembroiderySignature(rawBody, ff.webhookSecret, signature, timestamp)) {
    return NextResponse.json({ ok: false, error: "invalid webhook signature" }, { status: 401 });
  }

  const hookType = S(d.hookType ?? d.hook_type);
  const trackingNumber = S(d.trackingNumber ?? d.tracking_number);
  const trackingUrl = S(d.trackingUrl ?? d.tracking_url);
  const carrier = S(d.carrierCode ?? d.carrier_code ?? d.carrier);
  const rawStatus = S(d.status);

  const status = hookType === "update_tracking"
    ? "shipped"
    : mapWemStatus(rawStatus, !!(trackingNumber || ffo.trackingNumber));

  await db.update(schema.fulfillmentOrders).set({
    trackingNumber: trackingNumber || ffo.trackingNumber,
    trackingUrl: trackingUrl || ffo.trackingUrl,
    trackingCarrier: carrier || ffo.trackingCarrier,
    status: status as typeof ffo.status,
    trackingSyncedAt: trackingNumber ? new Date() : ffo.trackingSyncedAt,
  }).where(eq(schema.fulfillmentOrders.id, ffo.id));
  await syncOrderFromFf(ffo.orderId, status);
  if (trackingNumber) { await autoPushEtsyTracking(ffo.orderId); await markShippedOnTracking(ffo.orderId); }

  if (status === "cancelled") {
    // ĐƠN BỊ HUỶ/REFUND bên Wembroidery → xoá chi phí + đơn về Cancel (giống Merchize)
    if (ffo.externalFfId) {
      await db.delete(schema.transactions).where(and(
        eq(schema.transactions.orderId, ffo.orderId),
        eq(schema.transactions.type, "base_cost"),
        like(schema.transactions.note, `%${ffo.externalFfId}%`),
      ));
    }
    await db.update(schema.fulfillmentOrders).set({ baseCost: "0", shipCost: "0", extraFee: "0", cost: "0", costEvents: {} }).where(eq(schema.fulfillmentOrders.id, ffo.id));
    await db.update(schema.orders).set({ status: "cancel", updatedAt: new Date() }).where(eq(schema.orders.id, ffo.orderId));
    await refundOrderCost(ffo.orderId, "Refund cost — cancelled/refunded by Wembroidery");
    return NextResponse.json({ ok: true, matched: ffo.id, status, trashed: true });
  }
  if (trackingNumber || status === "shipped") {
    await db.update(schema.orders).set({ status: "shipped", updatedAt: new Date() })
      .where(and(eq(schema.orders.id, ffo.orderId), inArray(schema.orders.status, ["new", "created", "in_production"])));
  } else if (status === "in_production") {
    await db.update(schema.orders).set({ status: "in_production", updatedAt: new Date() })
      .where(and(eq(schema.orders.id, ffo.orderId), inArray(schema.orders.status, ["new", "created"])));
  }

  return NextResponse.json({ ok: true, matched: ffo.id, status, tracking: trackingNumber || undefined });
}
