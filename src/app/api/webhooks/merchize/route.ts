import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

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
  if (!orderCode && !externalNumber) return NextResponse.json({ ok: false, error: "thiếu order_code/external_number" }, { status: 400 });

  // Tìm fulfillment order: ưu tiên order_code (= external_ff_id), else theo external_number → order → ff order
  let ffo = orderCode
    ? (await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.externalFfId, orderCode)).limit(1))[0]
    : undefined;
  if (!ffo && externalNumber) {
    const [ord] = await db.select().from(schema.orders).where(eq(schema.orders.externalId, externalNumber)).limit(1);
    if (ord) ffo = (await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.orderId, ord.id)).limit(1))[0];
  }
  if (!ffo) return NextResponse.json({ ok: false, error: "không tìm thấy đơn khớp" }, { status: 404 });

  // Xác thực secret theo nhà fulfill của đơn (phải là Merchize và secret khớp)
  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, ffo.fulfillerId)).limit(1);
  if (!ff?.webhookSecret || key !== ff.webhookSecret) {
    return NextResponse.json({ ok: false, error: "sai webhook key" }, { status: 401 });
  }

  const ev = String(b?.event_type ?? "").toUpperCase();
  const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? undefined : n; };

  // ---- Sự kiện PAYMENT: ghi giá vốn/ship/phí vào ff order (KHÔNG đổi tracking/status) ----
  // CHỈ nhận diện qua event_type — vì event tracking cũng mang shipping_cost, tránh bắt nhầm.
  if (ev.includes("PAYMENT")) {
    const fulfillmentCost = num(r.fulfillment_cost);
    const shippingCost = num(r.shipping_cost);
    const patch: Record<string, unknown> = {};
    let extra = Number(ffo.extraFee ?? 0);

    if (fulfillmentCost !== undefined || shippingCost !== undefined) {
      // FULFILLMENT_COST: đặt base + ship, cộng branding − discount vào extra
      if (fulfillmentCost !== undefined) patch.baseCost = fulfillmentCost.toFixed(2);
      if (shippingCost !== undefined) patch.shipCost = shippingCost.toFixed(2);
      const branding = num(r.branding_cost) ?? 0;
      const discount = num(r.discount_amount) ?? 0;
      extra += branding - discount;
      patch.extraFee = extra.toFixed(2);
    } else if (/SURCHARGE|TRANSACTION|FEE/.test(ev)) {
      // SURCHARGE / TRANSACTION_FEE: phụ phí ở field price → cộng dồn vào extra
      const amt = num(r.price) ?? num(r.amount) ?? 0;
      extra += amt;
      patch.extraFee = extra.toFixed(2);
    }

    // cost tổng = base + ship + extra (dùng giá trị mới nhất)
    const base = patch.baseCost !== undefined ? Number(patch.baseCost) : Number(ffo.baseCost ?? 0);
    const ship = patch.shipCost !== undefined ? Number(patch.shipCost) : Number(ffo.shipCost ?? 0);
    patch.cost = (base + ship + extra).toFixed(2);

    await db.update(schema.fulfillmentOrders).set(patch).where(eq(schema.fulfillmentOrders.id, ffo.id));
    return NextResponse.json({ ok: true, matched: ffo.id, updated: "cost", cost: patch.cost });
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

  // Đồng bộ trạng thái đơn chính
  if (trackingNumber || status === "shipped") {
    await db.update(schema.orders).set({ status: "shipped", updatedAt: new Date() }).where(eq(schema.orders.id, ffo.orderId));
  } else if (status === "in_production") {
    await db.update(schema.orders).set({ status: "in_production", updatedAt: new Date() }).where(eq(schema.orders.id, ffo.orderId));
  }

  return NextResponse.json({ ok: true, matched: ffo.id, status });
}
