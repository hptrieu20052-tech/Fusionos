import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { autoPushEtsyTracking } from "@/lib/etsy-tracking";
import { syncOrderFromFf, refundOrderCost, markShippedOnTracking } from "@/lib/order-status";
import { mapOnosStatus } from "@/lib/onos";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/onos — nhận webhook ONOS (topic 'order.updated' | 'shipment.events').
 * ONOS ký HMAC-SHA256 payload bằng secret đăng ký (fulfillers.webhook_secret) và gửi lại trong header.
 * Header tên chưa cố định trong docs → dò các tên phổ biến; chấp nhận hex có/không prefix "sha256=".
 * Khớp đơn theo onos_id (external_ff_id) hoặc order_id/reference_id (orderLabel/externalId của FUSION).
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let b: Record<string, unknown> | null = null;
  try { b = JSON.parse(rawBody) as Record<string, unknown>; } catch { /* giữ null */ }
  if (!b) return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });

  // Payload có thể bọc trong data — dò cả 2 tầng
  const d = (b.data && typeof b.data === "object" ? (b.data as Record<string, unknown>) : b);
  const S = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  const pick = (...names: string[]) => {
    for (const n of names) {
      const v = d[n] ?? b![n] ?? (d.order as Record<string, unknown> | undefined)?.[n] ?? (d.tracking as Record<string, unknown> | undefined)?.[n];
      if (v) return S(v);
    }
    return "";
  };

  const onosId = pick("onos_id", "id", "code", "order_code", "name");
  const extNumber = pick("order_id", "reference_id", "external_id", "order_name");
  if (!onosId && !extNumber) return NextResponse.json({ ok: false, error: "missing order identifiers" }, { status: 400 });

  // Tìm fulfillment order: ưu tiên onos_id (= external_ff_id), else theo order_id/reference_id
  let ffo = onosId
    ? (await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.externalFfId, onosId)).limit(1))[0]
    : undefined;
  if (!ffo && extNumber) {
    const [ord] = await db.select().from(schema.orders)
      .where(or(eq(schema.orders.externalId, extNumber), eq(schema.orders.orderLabel, extNumber))).limit(1);
    if (ord) ffo = (await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.orderId, ord.id)).limit(1))[0];
  }
  // extNumber cũng có thể chính là external_ff_id (khi tạo đơn dedupe dùng order_id làm mã)
  if (!ffo && extNumber) {
    ffo = (await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.externalFfId, extNumber)).limit(1))[0];
  }
  if (!ffo) return NextResponse.json({ ok: false, error: "no matching order found" }, { status: 404 });

  // Xác thực HMAC-SHA256 theo secret của nhà ONOS
  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, ffo.fulfillerId)).limit(1);
  if (!ff?.webhookSecret) return NextResponse.json({ ok: false, error: "webhook secret not configured — run Register webhook first" }, { status: 401 });
  const sigHeader = req.headers.get("x-onos-signature") ?? req.headers.get("x-signature")
    ?? req.headers.get("x-webhook-signature") ?? req.headers.get("x-hub-signature-256") ?? req.headers.get("signature");
  const received = (sigHeader ?? "").replace(/^sha256=/i, "").trim();
  const expectedHex = crypto.createHmac("sha256", ff.webhookSecret).update(rawBody).digest("hex");
  const expectedB64 = crypto.createHmac("sha256", ff.webhookSecret).update(rawBody).digest("base64");
  const eq256 = (a: string, e: string) => { try { return a.length === e.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(e)); } catch { return false; } };
  if (!received || (!eq256(received, expectedHex) && !eq256(received, expectedB64))) {
    return NextResponse.json({ ok: false, error: "invalid webhook signature" }, { status: 401 });
  }

  // Tracking + trạng thái — dò nhiều tên field
  const trackingNumber = pick("tracking_number", "trackingNumber", "tracking_code");
  const trackingUrl = pick("tracking_url", "trackingUrl", "tracking_link");
  const carrier = pick("carrier", "carrier_code", "shipping_carrier", "tracking_company");
  const rawStatus = pick("status", "order_status", "shipment_status", "new_status");
  const topic = S(b.topic ?? b.event ?? b.hookType ?? "");

  const status = mapOnosStatus(rawStatus || topic, !!trackingNumber);

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
    // ĐƠN BỊ HUỶ bên ONOS → xoá chi phí + đơn về Cancel (giống Merchize)
    if (ffo.externalFfId) {
      await db.delete(schema.transactions).where(and(
        eq(schema.transactions.orderId, ffo.orderId),
        eq(schema.transactions.type, "base_cost"),
        like(schema.transactions.note, `%${ffo.externalFfId}%`),
      ));
    }
    await db.update(schema.fulfillmentOrders).set({ baseCost: "0", shipCost: "0", extraFee: "0", cost: "0", costEvents: {} }).where(eq(schema.fulfillmentOrders.id, ffo.id));
    await db.update(schema.orders).set({ status: "cancel", updatedAt: new Date() }).where(eq(schema.orders.id, ffo.orderId));
    await refundOrderCost(ffo.orderId, "Refund cost — cancelled by ONOS");
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
