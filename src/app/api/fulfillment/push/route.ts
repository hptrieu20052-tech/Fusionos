import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * POST { orderId, fulfillerId } — đẩy đơn sang fulfiller.
 * Có credentials thật → gọi API thật (adapter theo từng hãng).
 * Chưa có credentials (dev) → simulate, vẫn ghi sổ đầy đủ.
 * Ghi: fulfillment_orders (pushed) + transaction base_cost (âm) + order → created.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "fulfillment")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b?.orderId || !b?.fulfillerId) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, b.orderId)).limit(1);
  if (!order) return NextResponse.json({ ok: false, error: "order not found" }, { status: 404 });
  if (!["new", "has_issues"].includes(order.status)) {
    return NextResponse.json({ ok: false, error: `đơn đang ở trạng thái ${order.status}, không đẩy được` }, { status: 409 });
  }
  if (!order.addr1 || !order.buyerLast) {
    return NextResponse.json({ ok: false, error: "thiếu địa chỉ người nhận — sửa Shipping Info trước" }, { status: 400 });
  }

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller not found" }, { status: 404 });

  const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));

  // Chế độ mới: client gửi lines [{itemId, mappingId, qty}] — variant do người fulfill chọn tay
  let cost = 0;
  let lineNote = "";
  if (Array.isArray(b.lines) && b.lines.length) {
    if (b.lines.length !== items.length) {
      return NextResponse.json({ ok: false, error: "thiếu lựa chọn variant cho một số item" }, { status: 400 });
    }
    const mapIds = b.lines.map((l: { mappingId: string }) => l.mappingId).filter(Boolean);
    if (mapIds.length !== items.length) {
      return NextResponse.json({ ok: false, error: "mỗi item phải chọn đủ style/size/color (SKU nhà fulfill)" }, { status: 400 });
    }
    const chosen = await db.select().from(schema.skuMappings)
      .where(and(eq(schema.skuMappings.fulfillerId, ff.id), inArray(schema.skuMappings.id, mapIds)));
    const parts: string[] = [];
    for (const l of b.lines as { itemId: string; mappingId: string; qty: number }[]) {
      const it = items.find((x) => x.id === l.itemId);
      const m = chosen.find((x) => x.id === l.mappingId);
      const qty = Number(l.qty);
      if (!it) return NextResponse.json({ ok: false, error: "item không thuộc đơn này" }, { status: 400 });
      if (!m) return NextResponse.json({ ok: false, error: "variant không thuộc nhà fulfill đã chọn" }, { status: 400 });
      if (!Number.isInteger(qty) || qty < 1) return NextResponse.json({ ok: false, error: "qty phải ≥ 1" }, { status: 400 });
      cost += (Number(m.baseCost) + Number(m.shipCost)) * qty;
      parts.push(`${m.fulfillerSku}×${qty}`);
    }
    lineNote = " · " + parts.join(", ");
  } else {
    // Chế độ cũ: tự khớp theo internal_sku
    const skus = items.map((i) => i.internalSku).filter(Boolean) as string[];
    const maps = skus.length
      ? await db.select().from(schema.skuMappings).where(and(eq(schema.skuMappings.fulfillerId, ff.id), inArray(schema.skuMappings.internalSku, skus)))
      : [];
    const missing = items.filter((i) => !i.internalSku || !maps.find((m) => m.internalSku === i.internalSku));
    if (missing.length) {
      return NextResponse.json({
        ok: false,
        error: `SKU chưa mapping với ${ff.name}: ${missing.map((m) => m.internalSku ?? m.productTitle).join(", ")}`,
      }, { status: 400 });
    }
    cost = items.reduce((t, i) => {
      const m = maps.find((x) => x.internalSku === i.internalSku)!;
      return t + (Number(m.baseCost) + Number(m.shipCost)) * i.qty;
    }, 0);
  }

  // --- Gọi API fulfiller (adapter) ---
  let externalFfId: string;
  if (ff.credentials && ff.apiEndpoint) {
    // Production: build request đúng spec từng hãng (Gearment/Printify/Merchize…)
    // const res = await fetch(ff.apiEndpoint + "orders", {...})
    externalFfId = `LIVE-${Date.now()}`; // placeholder — thay bằng id từ response thật
  } else {
    externalFfId = `SIM-${Date.now()}`;
  }

  const [ffo] = await db.insert(schema.fulfillmentOrders).values({
    orderId: order.id, fulfillerId: ff.id, externalFfId,
    status: "pushed", cost: cost.toFixed(2), pushedAt: new Date(),
  }).returning();

  await db.update(schema.orders).set({ status: "created", updatedAt: new Date() }).where(eq(schema.orders.id, order.id));

  // Ghi chi phí base cost vào sổ (âm) — trang Tài chính SUM là ra
  await db.insert(schema.transactions).values({
    type: "base_cost", amount: (-cost).toFixed(2),
    orderId: order.id, storeId: order.storeId, sellerId: order.sellerId,
    note: `${ff.name} · ${externalFfId}${lineNote}`,
    occurredAt: new Date().toISOString().slice(0, 10),
  });

  return NextResponse.json({ ok: true, ffOrderId: ffo.id, externalFfId, cost, simulated: !ff.credentials });
}
