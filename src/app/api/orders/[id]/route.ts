import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf, hasRestriction } from "@/lib/rbac";
import { inScope } from "@/lib/scope";
import { refundOrderCost, cancelAtPrinters } from "@/lib/order-status";
import { parseVariant } from "@/lib/variant";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

async function guard(orderId: string, min: 1 | 2) {
  const session = await getSession();
  if (!session) return { err: NextResponse.json({ ok: false }, { status: 401 }) };
  if ((await levelOf(session, "orders")) < min) return { err: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }) };
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order) return { err: NextResponse.json({ ok: false, error: "not found" }, { status: 404 }) };
  if (!(await inScope(session, "orders", order.sellerId))) {
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
  // Catalog SEED (nhẹ): CHỈ variant khớp sẵn SKU của các item trong đơn — để tự điền + tính giá ngay.
  // KHÔNG dump toàn bộ 1000+ SKU nữa (gây phồng payload + treo dropdown). Muốn chọn khác → form tìm động
  // qua /api/fulfillers/variants (server-side filter + giới hạn kết quả).
  const catalog: Record<string, { id: string; fulfillerSku: string; internalSku: string; unitCost: number; style: string; provider: string; color: string; size: string; variant: string }[]> = {};
  for (const m of maps) {
    const { style, color, size } = parseVariant(m.variant, m.productType);
    // Printify: nhà in nằm sau " · " trong fulfillerProduct → tách làm cột Provider để chọn khi tạo đơn.
    const fp = m.fulfillerProduct ?? "";
    const provider = (m.fulfillerSku?.startsWith("PF-") && fp.includes(" · ")) ? fp.split(" · ").slice(1).join(" · ").trim() : "";
    (catalog[m.fulfillerId] ??= []).push({ id: m.id, fulfillerSku: m.fulfillerSku, internalSku: m.internalSku, unitCost: Number(m.baseCost) + Number(m.shipCost), style, provider, color, size, variant: m.variant ?? "" });
  }
  for (const k of Object.keys(catalog)) catalog[k].sort((a, b) => a.fulfillerSku.localeCompare(b.fulfillerSku));

  // Nhà nào ĐÃ CÓ sản phẩm (mapping) — để cột "Fulfilled by" không báo nhầm "no SKU mapping"
  const cntRows = (await db.execute(sql`
    SELECT fulfiller_id AS ff, count(*)::int AS c FROM sku_mappings WHERE active = true GROUP BY fulfiller_id
  `)).rows as { ff: string; c: number }[];
  const hasProducts = new Map(cntRows.map((r) => [r.ff, r.c > 0]));

  const options = fulfillers.map((f) => {
    const lines = items.map((it) => {
      const m = maps.find((x) => x.internalSku === it.internalSku && x.fulfillerId === f.id);
      return m ? (Number(m.baseCost) + Number(m.shipCost)) * it.qty : null;
    });
    const autoMatched = lines.every((l) => l !== null); // khớp sẵn SKU đơn → tự tính giá
    const mapped = hasProducts.get(f.id) ?? false;       // nhà đã có sản phẩm để chọn
    return { fulfillerId: f.id, name: f.name, mapped, estCost: autoMatched ? lines.reduce((t, l) => t! + l!, 0) : null };
  });

  const hideCustomer = await hasRestriction(session, "hide_customer_info");
  const hideProfit = await hasRestriction(session, "hide_profit");
  const masked = hideCustomer
    ? { ...order, buyerFirst: "***", buyerLast: "***", addr1: "***", addr2: null, city: "***", zip: "***" }
    : order;

  // Mapping chi tiết theo item × fulfiller (SKU nhà cung cấp + giá vốn đơn vị)
  const itemsOut = items.map((it) => ({
    ...it,
    mockupUrl: fileUrl(it.mockupKey),
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
    ffOrders: ffOrders.map((x) => {
      const f = { ...x.f, fulfillerName: x.name } as Record<string, unknown>;
      if (hideProfit) { f.cost = null; f.baseCost = null; f.shipCost = null; f.extraFee = null; }
      return f;
    }),
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
  // Non-admin chỉ được sửa địa chỉ khi đơn còn NEW; đơn đã Create thì bỏ qua các field địa chỉ
  const addrLocked = g.session.role !== "admin" && g.order.status !== "new";
  const addrKeys = ["buyerFirst", "buyerLast", "addr1", "addr2", "city", "state", "zip", "country"];
  for (const k of ["buyerFirst", "buyerLast", "addr1", "addr2", "city", "state", "zip", "country", "orderLabel", "note"] as const) {
    if (addrLocked && addrKeys.includes(k)) continue;
    if (typeof b[k] === "string") patch[k] = b[k];
  }
  // Workflow: trash cũ = cancel mới (đồng bộ tên với nhà in); out_of_stock bỏ
  if (b.status === "trash") b.status = "cancel";
  if (b.status === "out_of_stock") {
    return NextResponse.json({ ok: false, error: "This status is deprecated — use Cancel / Has Issues" }, { status: 400 });
  }
  if (b.status && (schema.orders.status.enumValues as readonly string[]).includes(b.status)) patch.status = b.status;

  await db.update(schema.orders).set(patch).where(eq(schema.orders.id, params.id));

  // Cancel → hoàn giá vốn về 0 + best-effort huỷ luôn bên nhà in
  let remoteCancel: string[] = [];
  if (b.status === "cancel") {
    await refundOrderCost(params.id, "Refund cost — order cancelled");
    remoteCancel = await cancelAtPrinters(params.id);
  }
  return NextResponse.json({ ok: true, remoteCancel });
}
