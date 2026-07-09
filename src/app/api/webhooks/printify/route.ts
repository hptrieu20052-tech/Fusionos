import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, like, or, desc } from "drizzle-orm";
import { getPrintifyOrder } from "@/lib/printify";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/printify — Printify bắn khi đơn đổi (updated / sent-to-production / shipment).
 * Tự cập nhật: base/ship/tax cost, tracking, trạng thái. KHÔNG cần bấm nút.
 * Body Printify: { type, resource: { id, data } } — resource.id = Printify order id.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const resource = (body?.resource ?? {}) as Record<string, unknown>;
  const printifyOrderId = String(resource.id ?? body?.id ?? "");
  const evtType = String(body?.type ?? "");
  if (!printifyOrderId) return NextResponse.json({ ok: true, skipped: "no order id" });

  // Khớp bản ghi fulfillment: ưu tiên theo Printify order id; nếu không có → theo external_id (TênStore-IDĐơn) của đơn
  const rd = (resource.data ?? {}) as Record<string, unknown>;
  const externalRef = String(rd.external_id ?? rd.label ?? "").trim();
  let [ffo] = await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.externalFfId, printifyOrderId)).limit(1);
  if (!ffo && externalRef) {
    const [ord0] = await db.select().from(schema.orders).where(or(eq(schema.orders.orderLabel, externalRef), eq(schema.orders.externalId, externalRef))).limit(1);
    if (ord0) [ffo] = await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.orderId, ord0.id)).orderBy(desc(schema.fulfillmentOrders.createdAt)).limit(1);
  }
  if (!ffo) return NextResponse.json({ ok: true, skipped: "no matching order", printifyOrderId, externalRef });

  // Lấy creds nhà in để GET đơn đầy đủ (cost + shipments)
  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, ffo.fulfillerId)).limit(1);
  const c = (ff?.credentials ?? {}) as { apiKey?: string; apiToken?: string; shopId?: string | number };
  const token = c.apiKey || c.apiToken;
  const shopId = c.shopId;

  let ord = (resource.data ?? {}) as Record<string, unknown>;
  if (token && shopId) {
    try { ord = (await getPrintifyOrder(token, shopId, printifyOrderId)) as Record<string, unknown>; } catch { /* dùng resource.data */ }
  }

  const cents = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };
  const items = (Array.isArray(ord?.line_items) ? ord.line_items : []) as Record<string, unknown>[];
  const baseC = items.reduce((s, it) => s + cents(it.cost), 0);
  const shipC = cents(ord?.total_shipping) || items.reduce((s, it) => s + cents(it.shipping_cost), 0);
  const taxC = cents(ord?.total_tax);
  const hasCost = !!(baseC || shipC || taxC);

  // Tracking từ shipments[0]
  const shipments = (Array.isArray(ord?.shipments) ? ord.shipments : []) as Record<string, unknown>[];
  const sh = shipments[0];
  const trackingNumber = sh?.number ? String(sh.number) : null;
  const carrier = sh?.carrier ? String(sh.carrier) : null;
  const trackingUrl = sh?.url ? String(sh.url) : null;

  // Trạng thái ffo: từ event type hoặc order.status
  const pfStatus = String(ord?.status ?? "").toLowerCase();
  const isCancel = evtType.includes("cancel") || pfStatus === "canceled" || pfStatus === "cancelled"
    || !!ord?.canceled_at || !!ord?.cancelled_at;
  let status = ffo.status;
  if (isCancel) status = "cancelled";
  else if (evtType.includes("delivered") || pfStatus === "delivered") status = "delivered";
  else if (evtType.includes("shipment") || trackingNumber || pfStatus === "fulfilled" || pfStatus === "shipped") status = "shipped";
  else if (evtType.includes("sent-to-production") || pfStatus.includes("production")) status = "in_production";

  const patch: Record<string, unknown> = { status };
  if (hasCost && !isCancel) {
    patch.baseCost = (baseC / 100).toFixed(2);
    patch.shipCost = (shipC / 100).toFixed(2);
    patch.extraFee = (taxC / 100).toFixed(2);
    patch.cost = ((baseC + shipC + taxC) / 100).toFixed(2);
  }
  if (trackingNumber) {
    patch.trackingNumber = trackingNumber;
    patch.trackingCarrier = carrier;
    patch.trackingUrl = trackingUrl;
    patch.trackingSyncedAt = new Date();
  }
  await db.update(schema.fulfillmentOrders).set(patch).where(eq(schema.fulfillmentOrders.id, ffo.id));

  // ĐƠN BỊ HUỶ bên Printify → đưa đơn vào TRASH + XOÁ chi phí (seller không phải chịu)
  if (isCancel) {
    await db.delete(schema.transactions).where(and(
      eq(schema.transactions.orderId, ffo.orderId),
      eq(schema.transactions.type, "base_cost"),
      like(schema.transactions.note, `%${printifyOrderId}%`),
    ));
    await db.update(schema.fulfillmentOrders).set({ baseCost: "0", shipCost: "0", extraFee: "0", cost: "0" }).where(eq(schema.fulfillmentOrders.id, ffo.id));
    await db.update(schema.orders).set({ status: "trash", updatedAt: new Date() }).where(eq(schema.orders.id, ffo.orderId));
    return NextResponse.json({ ok: true, updated: ffo.id, status: "cancelled", trashed: true });
  }

  // Cập nhật bút toán base_cost = giá THẬT (thay giá ước tính lúc đẩy)
  if (hasCost) {
    const total = (baseC + shipC + taxC) / 100;
    await db.update(schema.transactions).set({ amount: (-total).toFixed(2) }).where(and(
      eq(schema.transactions.orderId, ffo.orderId),
      eq(schema.transactions.type, "base_cost"),
      like(schema.transactions.note, `%${printifyOrderId}%`),
    ));
  }

  // Đồng bộ trạng thái đơn chính (chỉ tiến, không lùi). Đơn chính không có 'delivered' → coi như shipped.
  const orderStatus = status === "delivered" ? "shipped" : status;
  if (orderStatus === "shipped" || orderStatus === "in_production") {
    const advanceFrom: ("new" | "created" | "in_production")[] = orderStatus === "shipped" ? ["new", "created", "in_production"] : ["new", "created"];
    await db.update(schema.orders).set({ status: orderStatus, updatedAt: new Date() }).where(and(
      eq(schema.orders.id, ffo.orderId),
      inArray(schema.orders.status, advanceFrom),
    ));
  }

  return NextResponse.json({ ok: true, updated: ffo.id, status, cost: hasCost ? (baseC + shipC + taxC) / 100 : undefined, tracking: trackingNumber ?? undefined });
}
