import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { autoPushEtsyTracking } from "@/lib/etsy-tracking";
import { autoPushTiktokTracking } from "@/lib/tiktok-tracking";
import { markShippedOnTracking, syncOrderFromFf } from "@/lib/order-status";

export const dynamic = "force-dynamic";

/**
 * POST — fulfiller bắn webhook khi có tracking / đổi trạng thái.
 * Header: x-webhook-secret khớp fulfillers.webhook_secret.
 * Body: { externalFfId, trackingNumber?, carrier?, status? }
 * Cập nhật fulfillment_orders + orders → shipped. Bước sync ngược lên nền tảng do worker làm sau.
 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.externalFfId) return NextResponse.json({ ok: false, error: "externalFfId required" }, { status: 400 });

  const [ffo] = await db.select().from(schema.fulfillmentOrders)
    .where(eq(schema.fulfillmentOrders.externalFfId, String(b.externalFfId))).limit(1);
  if (!ffo) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, ffo.fulfillerId)).limit(1);
  const secret = req.headers.get("x-webhook-secret");
  if (!ff?.webhookSecret || secret !== ff.webhookSecret) {
    return NextResponse.json({ ok: false, error: "bad secret" }, { status: 401 });
  }

  const newStatus = ["in_production", "shipped", "delivered", "error", "cancelled"].includes(b.status) ? b.status : (b.trackingNumber ? "shipped" : ffo.status);

  await db.update(schema.fulfillmentOrders).set({
    trackingNumber: b.trackingNumber ?? ffo.trackingNumber,
    trackingCarrier: b.carrier ?? ffo.trackingCarrier,
    status: newStatus,
    trackingSyncedAt: b.trackingNumber ? new Date() : ffo.trackingSyncedAt,
  }).where(eq(schema.fulfillmentOrders.id, ffo.id));
  if (b.trackingNumber) { await autoPushEtsyTracking(ffo.orderId); await autoPushTiktokTracking(ffo.orderId); await markShippedOnTracking(ffo.orderId); } // CÓ TRACKING mới nhảy Shipped + đẩy Etsy/TikTok (bug cũ: thiếu {})

  if (b.trackingNumber || newStatus === "shipped") {
    await db.update(schema.orders).set({ status: "shipped", updatedAt: new Date() }).where(eq(schema.orders.id, ffo.orderId));
  } else if (newStatus === "in_production") {
    await db.update(schema.orders).set({ status: "in_production", updatedAt: new Date() }).where(eq(schema.orders.id, ffo.orderId));
  }

  await syncOrderFromFf(ffo.orderId, newStatus);
  return NextResponse.json({ ok: true, ffOrderId: ffo.id, status: newStatus });
}
