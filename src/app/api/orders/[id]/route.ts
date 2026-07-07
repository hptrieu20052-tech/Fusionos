import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf, hasRestriction } from "@/lib/rbac";

export const dynamic = "force-dynamic";

async function guard(orderId: string, min: 1 | 2) {
  const session = await getSession();
  if (!session) return { err: NextResponse.json({ ok: false }, { status: 401 }) };
  if ((await levelOf(session, "orders")) < min) return { err: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }) };
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order) return { err: NextResponse.json({ ok: false, error: "not found" }, { status: 404 }) };
  if ((await hasRestriction(session.sub, "own_orders_only")) && order.sellerId !== session.sub) {
    return { err: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }) };
  }
  return { session, order };
}

// GET /api/orders/[id] — chi tiết đơn: items, fulfillment history, fulfiller options + giá
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, 1);
  if ("err" in g) return g.err;
  const { session, order } = g;

  const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
  const [store] = order.storeId ? await db.select({ name: schema.stores.name }).from(schema.stores).where(eq(schema.stores.id, order.storeId)).limit(1) : [];
  const ffOrders = await db
    .select({ f: schema.fulfillmentOrders, name: schema.fulfillers.name })
    .from(schema.fulfillmentOrders)
    .leftJoin(schema.fulfillers, eq(schema.fulfillmentOrders.fulfillerId, schema.fulfillers.id))
    .where(eq(schema.fulfillmentOrders.orderId, order.id));

  const fulfillers = await db.select().from(schema.fulfillers);
  const skus = items.map((i) => i.internalSku).filter(Boolean) as string[];
  const maps = skus.length
    ? await db.select().from(schema.skuMappings).where(and(eq(schema.skuMappings.active, true), inArray(schema.skuMappings.internalSku, skus)))
    : [];
  // Catalog đầy đủ mọi variant của từng fulfiller (để chọn style/size/color tay)
  const allMaps = await db.select().from(schema.skuMappings).where(eq(schema.skuMappings.active, true));
  // Tách color/size từ trường variant tự do (vd "Navy / L", "L - Black", "Đen, XL")
  const SIZE_RE = /^(one size|os|free|xxs|xs|s|m|l|xl|xxl|2xl|3xl|4xl|5xl|\d{1,2}xl|\d{2,3})$/i;
  const parseVariant = (variant: string | null, productType: string | null) => {
    const style = (productType || "").trim() || "—";
    if (!variant) return { style, color: "—", size: "—" };
    const parts = variant.split(/[\/,|·–—-]| x /i).map((p) => p.trim()).filter(Boolean);
    let size = "", color = "";
    for (const p of parts) { if (!size && SIZE_RE.test(p)) size = p; else color = color ? `${color} ${p}` : p; }
    if (!size && parts.length) size = parts[parts.length - 1];
    if (!color) color = parts.length > 1 ? parts.slice(0, -1).join(" ") : "—";
    return { style, color: color || "—", size: size || "—" };
  };
  const catalog: Record<string, { id: string; fulfillerSku: string; internalSku: string; unitCost: number; style: string; color: string; size: string }[]> = {};
  for (const m of allMaps) {
    const { style, color, size } = parseVariant(m.variant, m.productType);
    (catalog[m.fulfillerId] ??= []).push({ id: m.id, fulfillerSku: m.fulfillerSku, internalSku: m.internalSku, unitCost: Number(m.baseCost) + Number(m.shipCost), style, color, size });
  }
  for (const k of Object.keys(catalog)) catalog[k].sort((a, b) => a.fulfillerSku.localeCompare(b.fulfillerSku));
  const options = fulfillers.map((f) => {
    const lines = items.map((it) => {
      const m = maps.find((x) => x.internalSku === it.internalSku && x.fulfillerId === f.id);
      return m ? (Number(m.baseCost) + Number(m.shipCost)) * it.qty : null;
    });
    const mapped = lines.every((l) => l !== null);
    return { fulfillerId: f.id, name: f.name, mapped, estCost: mapped ? lines.reduce((t, l) => t! + l!, 0) : null };
  });

  const hideCustomer = await hasRestriction(session.sub, "hide_customer_info");
  const hideProfit = await hasRestriction(session.sub, "hide_profit");
  const masked = hideCustomer
    ? { ...order, buyerFirst: "***", buyerLast: "***", addr1: "***", addr2: null, city: "***", zip: "***" }
    : order;

  // Mapping chi tiết theo item × fulfiller (SKU nhà cung cấp + giá vốn đơn vị)
  const itemsOut = items.map((it) => ({
    ...it,
    mappings: hideProfit ? {} : Object.fromEntries(
      maps.filter((m) => m.internalSku === it.internalSku)
        .map((m) => [m.fulfillerId, { fulfillerSku: m.fulfillerSku, unitCost: Number(m.baseCost) + Number(m.shipCost) }])
    ),
  }));

  return NextResponse.json({
    ok: true,
    storeName: store?.name ?? null,
    order: masked,
    items: itemsOut,
    ffOrders: ffOrders.map((x) => ({ ...x.f, fulfillerName: x.name })),
    fulfillerOptions: hideProfit ? options.map((o) => ({ ...o, estCost: null })) : options,
    catalog: hideProfit ? {} : catalog,
    hideProfit,
  });
}

// PATCH — sửa shipping info / trạng thái / order label
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, 2);
  if ("err" in g) return g.err;
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["buyerFirst", "buyerLast", "addr1", "addr2", "city", "state", "zip", "country", "orderLabel", "note"] as const) {
    if (typeof b[k] === "string") patch[k] = b[k];
  }
  // Workflow mới: không dùng cancel / out_of_stock nữa
  if (b.status === "cancel" || b.status === "out_of_stock") {
    return NextResponse.json({ ok: false, error: "Trạng thái này đã bỏ — đơn huỷ cho vào Trash, đơn lỗi dùng Has Issues" }, { status: 400 });
  }
  if (b.status && (schema.orders.status.enumValues as readonly string[]).includes(b.status)) patch.status = b.status;

  await db.update(schema.orders).set(patch).where(eq(schema.orders.id, params.id));

  // Vào Trash → hoàn giá vốn (base_cost về 0) để không trừ chi phí của seller
  if (b.status === "trash") {
    const sum = (await db.execute(sql`
      SELECT coalesce(sum(amount),0)::numeric s FROM transactions WHERE order_id = ${params.id}::uuid AND type = 'base_cost'
    `)).rows[0] as { s: string };
    const bal = Number(sum.s);
    if (bal < 0) {
      const [ord] = await db.select().from(schema.orders).where(eq(schema.orders.id, params.id)).limit(1);
      await db.insert(schema.transactions).values({
        type: "base_cost", amount: (-bal).toFixed(2),
        orderId: params.id, storeId: ord?.storeId ?? null, sellerId: ord?.sellerId ?? null,
        note: "Hoàn giá vốn — đơn chuyển vào Trash",
        occurredAt: new Date().toISOString().slice(0, 10),
      });
    }
  }
  return NextResponse.json({ ok: true });
}
