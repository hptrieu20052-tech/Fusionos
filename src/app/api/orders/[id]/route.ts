import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, isNotNull, like, or, sql } from "drizzle-orm";
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
  // v460 · lấy cả bản ghi GỘP ĐẨY nằm trên đơn anh em nhưng có chứa đơn này (merged_order_ids @> [id])
  const ffOrders = await db
    .select({ f: schema.fulfillmentOrders, name: schema.fulfillers.name })
    .from(schema.fulfillmentOrders)
    .leftJoin(schema.fulfillers, eq(schema.fulfillmentOrders.fulfillerId, schema.fulfillers.id))
    .where(or(
      eq(schema.fulfillmentOrders.orderId, order.id),
      sql`${schema.fulfillmentOrders.mergedOrderIds} @> ${JSON.stringify([order.id])}::jsonb`,
    ));

  // v460 · ĐƠN ANH EM cùng khách (Shopify split -CLONE-n) còn item CHƯA ĐẨY — cho panel gộp đẩy.
  // Chỉ người có quyền fulfillment (đẩy đơn) mới thấy — seller thường không thấy đơn của seller khác.
  const canFulfill = (await levelOf(session, "fulfillment")) >= 2;
  const extBase = order.externalId.replace(/-CLONE-\d+$/, "");
  let sibOrders: (typeof order)[] = [];
  // Item anh em ở DẠNG SNAKE_CASE (giống list endpoint) — để client render bằng ItemRow y như item thường.
  let sibItems: Record<string, unknown>[] = [];
  if (canFulfill && order.storeId && order.platform === "shopify") {
    const rows = await db.select().from(schema.orders).where(and(
      eq(schema.orders.storeId, order.storeId),
      or(eq(schema.orders.externalId, extBase), like(schema.orders.externalId, `${extBase}-CLONE-%`)),
      inArray(schema.orders.status, ["new", "has_issues", "created"]),
    ));
    sibOrders = rows.filter((r) => r.id !== order.id);
    if (sibOrders.length) {
      const sibIds = sibOrders.map((r) => r.id);
      const rawItems = (await db.execute(sql`
        SELECT i.*, d.sku_code AS design_sku, d.title AS design_title, df.thumb_key AS design_thumb
        FROM order_items i
        LEFT JOIN designs d ON d.id = i.design_id
        LEFT JOIN LATERAL (SELECT thumb_key FROM design_files WHERE design_id = d.id AND thumb_key IS NOT NULL LIMIT 1) df ON TRUE
        WHERE i.order_id IN (${sql.join(sibIds.map((x) => sql`${x}::uuid`), sql`, `)})
      `)).rows as Record<string, unknown>[];
      // Item đã nằm trong bản ghi đẩy nào đó (kể cả bản gộp của đơn khác) → loại khỏi danh sách gộp.
      const ffRaw = await db.select({
        orderId: schema.fulfillmentOrders.orderId, lines: schema.fulfillmentOrders.lines,
        mergedOrderIds: schema.fulfillmentOrders.mergedOrderIds,
      }).from(schema.fulfillmentOrders)
        .where(or(inArray(schema.fulfillmentOrders.orderId, sibIds), isNotNull(schema.fulfillmentOrders.mergedOrderIds)));
      const pushedIds = new Set(ffRaw
        .filter((f) => sibIds.includes(f.orderId) || (Array.isArray(f.mergedOrderIds) && (f.mergedOrderIds as unknown[]).some((x) => sibIds.includes(String(x)))))
        .flatMap((f) => Array.isArray(f.lines) ? (f.lines as { itemId?: string }[]).map((l) => l.itemId).filter(Boolean) as string[] : []));
      sibItems = rawItems.filter((it) => Number(it.qty ?? 0) >= 1 && !pushedIds.has(String(it.id)));
      sibOrders = sibOrders.filter((r) => sibItems.some((it) => String(it.order_id) === r.id));
    }
  }

  const fulfillers = await db.select().from(schema.fulfillers);
  const sibSkus = sibItems.map((i) => i.internal_sku as string | null);
  const skus = Array.from(new Set([...items.map((i) => i.internalSku), ...sibSkus].filter(Boolean))) as string[];
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
    return { fulfillerId: f.id, name: f.name, mapped, nonPod: !!f.nonPod, gsheet: ((f.credentials as { kind?: string } | null)?.kind) === "gsheet", estCost: autoMatched ? lines.reduce((t, l) => t! + l!, 0) : null };
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
      // TÁCH RIÊNG từng khoản phí cho seller nắm rõ (thay vì gộp cục "Tax/fee"):
      //   costEvents.tax  = import tax (poll đọc từ catalog Merchize)
      //   costEvents.fees = surcharge ("sur:...") / branding-discount ("fc:...") từ webhook
      // Gộp entry CÙNG SỐ TIỀN — đúng quy tắc dedup khi tính cost, để breakdown luôn khớp Total.
      const ce = (x.f.costEvents ?? {}) as { tax?: number; fees?: Record<string, number> };
      const seen = new Set<string>();
      const feeItems: { kind: string; amount: number }[] = [];
      for (const [k, v] of Object.entries(ce.fees ?? {})) {
        const a = Number(v || 0); if (!a) continue;
        const dk = a.toFixed(2); if (seen.has(dk)) continue; seen.add(dk);
        feeItems.push({ kind: k.startsWith("fc:") || k === "discount" ? "branding" : k === "design" ? "design" : k === "other" ? "other" : "surcharge", amount: a });
      }
      f.feeBreakdown = { importTax: Number(ce.tax ?? 0), items: feeItems };
      // v460 · bản ghi GỘP: mỗi đơn chỉ thấy LINE CỦA MÌNH (fromOrderId) — seller không thấy item đơn khác.
      const merged = Array.isArray(x.f.mergedOrderIds) && (x.f.mergedOrderIds as unknown[]).length > 0;
      if (merged && Array.isArray(x.f.lines)) {
        f.lines = (x.f.lines as { fromOrderId?: string }[]).filter((l) => !l.fromOrderId || l.fromOrderId === order.id);
      }
      f.merged = merged;                       // lần đẩy này gộp nhiều đơn (cost là TỔNG cả cụm)
      f.mergedFrom = x.f.orderId !== order.id; // bản ghi nằm trên đơn anh em, đơn này chỉ góp item
      if (hideProfit) { f.cost = null; f.baseCost = null; f.shipCost = null; f.extraFee = null; f.feeBreakdown = null; f.costEvents = null; }
      return f;
    }),
    // v460 · đơn anh em còn item chưa đẩy — panel đẩy hiện checkbox "gộp đẩy chung".
    // Item ở dạng snake_case (list shape) để client render bằng ItemRow như item thường.
    siblings: sibOrders.map((sb) => ({
      id: sb.id, externalId: sb.externalId, status: sb.status,
      items: sibItems.filter((it) => String(it.order_id) === sb.id).map((it) => ({
        ...it,
        designThumb: fileUrl((it.design_thumb as string | null) ?? null),
        designSides: [],
        mockupUrl: fileUrl((it.mockup_key as string | null) ?? null),
        imageUrl: (it.image_url as string | null) ?? null,
        productUrl: (it.product_url as string | null) ?? null,
        variant: (it.variant as string | null) ?? null,
        files: Array.isArray(it.buyer_files) ? it.buyer_files : [],
        suggests: [], custom: false, baseDesign: null,
        mappings: hideProfit ? {} : Object.fromEntries(
          maps.filter((m) => m.internalSku === (it.internal_sku as string | null))
            .map((m) => [m.fulfillerId, { fulfillerSku: m.fulfillerSku, unitCost: Number(m.baseCost) + Number(m.shipCost) }])
        ),
      })),
    })),
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
