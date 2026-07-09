import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getAdapter } from "@/lib/fulfillers";
import { fileUrl } from "@/lib/storage";

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

  // Map design URL (front/back/sleeve/hood) theo designId — cho adapter cần artwork (Merchize...)
  const designIds = Array.from(new Set(items.map((i) => i.designId).filter(Boolean))) as string[];
  const sideUrls = new Map<string, { front?: string; back?: string; sleeve?: string; hood?: string }>();
  if (designIds.length) {
    const files = await db.select().from(schema.designFiles).where(inArray(schema.designFiles.designId, designIds));
    for (const f of files) {
      const cur = sideUrls.get(f.designId) ?? {};
      const url = fileUrl(f.storageKey) ?? undefined;
      if (f.kind === "design_front") cur.front = url;
      else if (f.kind === "design_back") cur.back = url;
      sideUrls.set(f.designId, cur);
    }
  }
  const enrich = (it: typeof items[number], m: typeof schema.skuMappings.$inferSelect) => {
    const s = it.designId ? sideUrls.get(it.designId) ?? {} : {};
    return {
      internalSku: m.internalSku, productId: m.fulfillerProductId ?? null,
      price: Number(it.unitPrice) || undefined, currency: "USD",
      // Merchize image = mockup của ĐƠN (upload theo order), KHÔNG lấy từ card design.
      image: fileUrl(it.mockupKey) ?? null,
      designFront: s.front ?? null, designBack: s.back ?? null,
      pfBlueprintId: m.pfBlueprintId ?? null, pfProviderId: m.pfProviderId ?? null, pfVariantId: m.pfVariantId ?? null,
    };
  };

  // Chế độ mới: client gửi lines [{itemId, mappingId, qty}] — variant do người fulfill chọn tay
  let cost = 0;
  let baseSum = 0;
  let shipSum = 0;
  let lineNote = "";
  const pushLines: { fulfillerSku: string; qty: number }[] = [];
  const pushedLines: { product: string; variant: string | null; sku: string; qty: number }[] = [];
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
      baseSum += Number(m.baseCost) * qty;
      shipSum += Number(m.shipCost) * qty;
      cost += (Number(m.baseCost) + Number(m.shipCost)) * qty;
      parts.push(`${m.fulfillerSku}×${qty}`);
      pushLines.push({ fulfillerSku: m.fulfillerSku, qty, ...enrich(it, m) });
      pushedLines.push({ product: it.productTitle, variant: m.variant ?? null, sku: m.fulfillerSku, qty });
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
    for (const i of items) {
      const m = maps.find((x) => x.internalSku === i.internalSku)!;
      baseSum += Number(m.baseCost) * i.qty;
      shipSum += Number(m.shipCost) * i.qty;
      pushLines.push({ fulfillerSku: m.fulfillerSku, qty: i.qty, ...enrich(i, m) });
      pushedLines.push({ product: i.productTitle, variant: m.variant ?? null, sku: m.fulfillerSku, qty: i.qty });
    }
    cost = baseSum + shipSum;
  }

  // Đảm bảo số đơn gửi nhà in = TênStore-IDĐơn (nếu chưa set orderLabel thì tự dựng)
  let orderLabel = (order.orderLabel ?? "").trim();
  if (!orderLabel) {
    const [st] = order.storeId ? await db.select({ name: schema.stores.name }).from(schema.stores).where(eq(schema.stores.id, order.storeId)).limit(1) : [];
    const shop = (st?.name ?? "SHOP").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    orderLabel = `${shop}-${order.externalId}`;
  }

  // --- Gọi API fulfiller qua adapter theo từng nhà ---
  const adapter = getAdapter(ff.name);
  let pushRes;
  try {
    pushRes = await adapter.push({
      fulfiller: { id: ff.id, name: ff.name, apiEndpoint: ff.apiEndpoint, credentials: ff.credentials },
      order: {
        externalId: order.externalId, orderLabel,
        buyerFirst: order.buyerFirst, buyerLast: order.buyerLast,
        addr1: order.addr1, addr2: order.addr2, city: order.city,
        state: order.state, zip: order.zip, country: order.country,
      },
      lines: pushLines,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Đẩy đơn ${ff.name} thất bại: ${String((e as Error)?.message ?? e).slice(0, 400)}` }, { status: 502 });
  }
  const externalFfId = pushRes.externalFfId;

  // Chi phí: ưu tiên giá THẬT nhà in trả về (Printify); else giá vốn từ SKU mapping
  const finalBase = pushRes.baseCost != null ? pushRes.baseCost : baseSum;
  const finalShip = pushRes.shipCost != null ? pushRes.shipCost : shipSum;
  const finalTax = pushRes.tax ?? 0;
  const finalCost = finalBase + finalShip + finalTax;

  const [ffo] = await db.insert(schema.fulfillmentOrders).values({
    orderId: order.id, fulfillerId: ff.id, externalFfId,
    status: "pushed", cost: finalCost.toFixed(2), baseCost: finalBase.toFixed(2), shipCost: finalShip.toFixed(2), extraFee: finalTax.toFixed(2), pushedAt: new Date(),
    lines: pushedLines,
  }).returning();

  await db.update(schema.orders).set({ status: "created", updatedAt: new Date() }).where(eq(schema.orders.id, order.id));

  // Ghi chi phí vào sổ (âm) — trang Tài chính SUM là ra
  await db.insert(schema.transactions).values({
    type: "base_cost", amount: (-finalCost).toFixed(2),
    orderId: order.id, storeId: order.storeId, sellerId: order.sellerId,
    note: `${ff.name} · ${externalFfId}${lineNote}`,
    occurredAt: new Date().toISOString().slice(0, 10),
  });

  return NextResponse.json({ ok: true, ffOrderId: ffo.id, externalFfId, cost: finalCost, simulated: pushRes.simulated, reason: pushRes.reason });
}
