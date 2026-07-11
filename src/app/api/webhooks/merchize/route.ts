import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { autoPushEtsyTracking } from "@/lib/etsy-tracking";
import { syncOrderFromFf } from "@/lib/order-status";
import { markShippedOnTracking } from "@/lib/order-status";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/merchize — nhận webhook sự kiện đơn từ Merchize.
 * Header: merchize-webhook-key = fulfillers.webhook_secret (của nhà Merchize).
 * Body: { event_type, resource: { order_code, external_number, shipping_info, items, ... }, event_id, event_time }
 * Khớp đơn theo order_code (external_ff_id) hoặc external_number (order.external_id),
 * cập nhật tracking + trạng thái khi có sự kiện fulfill/ship.
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("merchize-webhook-key");
  const b = await req.json().catch(() => null);
  const r = b?.resource ?? {};
  const orderCode = String(r.order_code ?? "");
  const externalNumber = String(r.external_number ?? "");
  if (!orderCode && !externalNumber) return NextResponse.json({ ok: false, error: "missing order_code/external_number" }, { status: 400 });

  // Tìm fulfillment order: ưu tiên order_code (= external_ff_id), else theo external_number → order → ff order
  let ffo = orderCode
    ? (await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.externalFfId, orderCode)).limit(1))[0]
    : undefined;
  if (!ffo && externalNumber) {
    const [ord] = await db.select().from(schema.orders).where(or(eq(schema.orders.externalId, externalNumber), eq(schema.orders.orderLabel, externalNumber))).limit(1);
    if (ord) ffo = (await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.orderId, ord.id)).limit(1))[0];
  }
  if (!ffo) return NextResponse.json({ ok: false, error: "no matching order found" }, { status: 404 });

  // Xác thực secret theo nhà fulfill của đơn (phải là Merchize và secret khớp)
  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, ffo.fulfillerId)).limit(1);
  if (!ff?.webhookSecret || key !== ff.webhookSecret) {
    return NextResponse.json({ ok: false, error: "sai webhook key" }, { status: 401 });
  }

  const ev = String(b?.event_type ?? "").toUpperCase();
  const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? undefined : n; };

  // ---- Sự kiện PAYMENT: ghi giá vốn/ship/phí (idempotent qua costEvents; KHÔNG đổi tracking/status) ----
  if (ev.includes("PAYMENT")) {
    const fulfillmentCost = num(r.fulfillment_cost);
    const shippingCost = num(r.shipping_cost);
    const eventId = String(b?.event_id ?? b?.event_time ?? "");

    // Bản ghi chi phí hiện có: { base, ship, fees: { [eventId]: amount } }. Áp lại cùng eventId → ghi đè, không cộng trùng.
    const prev = (ffo.costEvents ?? {}) as { base?: number; ship?: number; fees?: Record<string, number> };
    const ce = { base: prev.base, ship: prev.ship, fees: { ...(prev.fees ?? {}) } };

    if (fulfillmentCost !== undefined || shippingCost !== undefined) {
      if (fulfillmentCost !== undefined) ce.base = fulfillmentCost;
      if (shippingCost !== undefined) ce.ship = shippingCost;
      const branding = num(r.branding_cost) ?? 0;
      const discount = num(r.discount_amount) ?? 0;
      if (branding || discount) ce.fees[`fc:${eventId}`] = branding - discount;
    } else if (/SURCHARGE|TRANSACTION|FEE|TAX/.test(ev)) {
      const amt = num(r.price) ?? num(r.amount) ?? num(r.tax) ?? num(r.tax_amount) ?? 0;
      ce.fees[eventId || `fee:${b?.event_time ?? Date.now()}`] = amt;
    } else {
      return NextResponse.json({ ok: true, matched: ffo.id, skipped: "payment event without cost" });
    }

    const base = Number(ce.base ?? ffo.baseCost ?? 0);
    const ship = Number(ce.ship ?? ffo.shipCost ?? 0);
    const extra = Object.values(ce.fees).reduce((s, v) => s + Number(v || 0), 0);
    const total = base + ship + extra;

    await db.update(schema.fulfillmentOrders).set({
      baseCost: base.toFixed(2), shipCost: ship.toFixed(2), extraFee: extra.toFixed(2), cost: total.toFixed(2), costEvents: ce,
    }).where(eq(schema.fulfillmentOrders.id, ffo.id));

    // Bút toán Tài chính = giá THẬT (luôn SET, không cộng → idempotent)
    if (ffo.externalFfId) {
      await db.update(schema.transactions).set({ amount: (-total).toFixed(2) }).where(and(
        eq(schema.transactions.orderId, ffo.orderId),
        eq(schema.transactions.type, "base_cost"),
        like(schema.transactions.note, `%${ffo.externalFfId}%`),
      ));
    }

    // Đã có phí fulfillment = đơn đã "paid" → In Production (chỉ tiến)
    if (fulfillmentCost !== undefined) {
      await db.update(schema.orders).set({ status: "in_production", updatedAt: new Date() })
        .where(and(eq(schema.orders.id, ffo.orderId), inArray(schema.orders.status, ["new", "created"])));
    }
    return NextResponse.json({ ok: true, matched: ffo.id, updated: "cost", base, ship, extra, cost: total });
  }

  // Lấy tracking (nếu có ở event ship) — Merchize để rải rác, dò nhiều tên field
  const pick = (...names: string[]) => { for (const n of names) { const v = r[n] ?? r.tracking?.[n] ?? r.shipment?.[n]; if (v) return String(v); } return ""; };
  const trackingNumber = pick("tracking_number", "tracking_code", "trackingNumber");
  const trackingUrl = pick("tracking_url", "trackingUrl");
  const carrier = pick("shipping_carrier", "carrier", "tracking_company", "shipping_company");

  // Map event → trạng thái (ưu tiên new_shipment_status của event SHIPMENT)
  const shipStatus = String(r.new_shipment_status ?? r.shipment_status ?? "").toLowerCase();
  let status = ffo.status as string;
  if (/DELIVER/.test(ev) || /deliver/.test(shipStatus)) status = "delivered";
  else if (/SHIP|TRANSIT|TRACKING/.test(ev) || trackingNumber || /transit|shipped|out_for_delivery|picked/.test(shipStatus)) status = "shipped";
  else if (/PRODUCT|PROCESS|ACCEPT|CREATED/.test(ev) || /pre_transit|label/.test(shipStatus)) status = "in_production";
  else if (/CANCEL/.test(ev)) status = "cancelled";
  else if (/return|fail|exception/.test(shipStatus)) status = "error";

  await db.update(schema.fulfillmentOrders).set({
    trackingNumber: trackingNumber || ffo.trackingNumber,
    trackingUrl: trackingUrl || ffo.trackingUrl,
    trackingCarrier: carrier || ffo.trackingCarrier,
    status: status as typeof ffo.status,
    trackingSyncedAt: trackingNumber ? new Date() : ffo.trackingSyncedAt,
  }).where(eq(schema.fulfillmentOrders.id, ffo.id));
  await syncOrderFromFf(ffo.orderId, status);
  if (trackingNumber) await autoPushEtsyTracking(ffo.orderId); await markShippedOnTracking(ffo.orderId); // tự đẩy tracking lên Etsy

  // Đồng bộ trạng thái đơn chính (chỉ tiến, không lùi)
  if (status === "cancelled") {
    // ĐƠN BỊ HUỶ bên Merchize → đưa đơn vào TRASH + XOÁ chi phí (seller không phải chịu)
    if (ffo.externalFfId) {
      await db.delete(schema.transactions).where(and(
        eq(schema.transactions.orderId, ffo.orderId),
        eq(schema.transactions.type, "base_cost"),
        like(schema.transactions.note, `%${ffo.externalFfId}%`),
      ));
    }
    await db.update(schema.fulfillmentOrders).set({ baseCost: "0", shipCost: "0", extraFee: "0", cost: "0", costEvents: {} }).where(eq(schema.fulfillmentOrders.id, ffo.id));
    await db.update(schema.orders).set({ status: "trash", updatedAt: new Date() }).where(eq(schema.orders.id, ffo.orderId));
    return NextResponse.json({ ok: true, matched: ffo.id, status, trashed: true });
  }
  if (trackingNumber || status === "shipped") {
    await db.update(schema.orders).set({ status: "shipped", updatedAt: new Date() })
      .where(and(eq(schema.orders.id, ffo.orderId), inArray(schema.orders.status, ["new", "created", "in_production"])));
  } else if (status === "in_production") {
    await db.update(schema.orders).set({ status: "in_production", updatedAt: new Date() })
      .where(and(eq(schema.orders.id, ffo.orderId), inArray(schema.orders.status, ["new", "created"])));
  }

  return NextResponse.json({ ok: true, matched: ffo.id, status });
}
