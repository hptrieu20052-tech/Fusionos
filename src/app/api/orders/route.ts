import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf, hasRestriction } from "@/lib/rbac";
import { scopeOwnerIds, resolveScope } from "@/lib/scope";
import { fileUrl } from "@/lib/storage";
import { suggestForItems } from "@/lib/design-suggest";

export const dynamic = "force-dynamic";

// GET /api/orders?status=&sellerId=&storeId=&q=&qMode=text|order&from=&to=&page=1&show=20
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "orders")) < 1) {
    return NextResponse.json({ ok: false, error: "forbidden: no access to orders" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const show = Math.min(Math.max(Number(sp.get("show") ?? 20), 5), 100);
  const page = Math.max(Number(sp.get("page") ?? 1), 1);
  const scopeIds = await scopeOwnerIds(session, "orders");
  const hideCustomer = await hasRestriction(session, "hide_customer_info");

  const conds: ReturnType<typeof sql>[] = [];
  if (scopeIds) conds.push(sql`o.seller_id IN (${sql.join(scopeIds.map((x) => sql`${x}::uuid`), sql`, `)})`);
  else if (sp.get("sellerId")) conds.push(sql`o.seller_id = ${sp.get("sellerId")}::uuid`);
  if (sp.get("storeId")) conds.push(sql`o.store_id = ${sp.get("storeId")}::uuid`);
  if (sp.get("platform")) conds.push(sql`o.platform = ${sp.get("platform")}::marketplace`);
  if (sp.get("fulfillerId")) conds.push(sql`EXISTS (SELECT 1 FROM fulfillment_orders fo WHERE fo.order_id = o.id AND fo.fulfiller_id = ${sp.get("fulfillerId")}::uuid)`);
  // Lọc theo tình trạng gán design: "assigned" = mọi sản phẩm đã có design; "unassigned" = còn ít nhất 1 sản phẩm thiếu
  const dz = sp.get("design");
  if (dz === "assigned") conds.push(sql`NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.design_id IS NULL)`);
  else if (dz === "unassigned") conds.push(sql`EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.design_id IS NULL)`);
  const q = sp.get("q")?.trim();
  if (q) {
    const like = "%" + q + "%";
    conds.push(sql`(
      o.external_id ILIKE ${like}
      OR coalesce(o.order_label,'') ILIKE ${like}
      OR (coalesce(o.buyer_first,'') || ' ' || coalesce(o.buyer_last,'')) ILIKE ${like}
      OR EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = o.id AND x.product_title ILIKE ${like})
    )`);
  }
  if (sp.get("from")) conds.push(sql`o.ordered_at::date >= ${sp.get("from")}::date`);
  if (sp.get("to")) conds.push(sql`o.ordered_at::date <= ${sp.get("to")}::date`);
  // Điều kiện KHÔNG gồm status → dùng cho đếm pill (mỗi tab đếm trong cùng bộ lọc hiện tại)
  const baseWhere = conds.length ? conds.reduce((a, c) => sql`${a} AND ${c}`) : sql`TRUE`;

  const status = sp.get("status");
  const listConds = [...conds];
  if (status && (schema.orders.status.enumValues as readonly string[]).includes(status)) listConds.push(sql`o.status = ${status}::order_status`);
  const where = listConds.length ? listConds.reduce((a, c) => sql`${a} AND ${c}`) : sql`TRUE`;

  const totalR = await db.execute(sql`SELECT count(*)::int t FROM orders o WHERE ${where}`);
  const total = (totalR.rows[0] as { t: number }).t;

  const rows = await db.execute(sql`
    SELECT o.*, u.full_name AS seller_name, s.name AS store_name
    FROM orders o
    LEFT JOIN users u ON u.id = o.seller_id
    LEFT JOIN stores s ON s.id = o.store_id
    WHERE ${where}
    ORDER BY o.ordered_at DESC
    LIMIT ${show} OFFSET ${(page - 1) * show}
  `);
  const orders = rows.rows as Record<string, unknown>[];
  const ids = orders.map((o) => o.id as string);

  // Items + design đã gán (thumb qua design_files)
  const items = ids.length ? (await db.execute(sql`
    SELECT i.*, d.sku_code AS design_sku, d.title AS design_title, df.thumb_key AS design_thumb
    FROM order_items i
    LEFT JOIN designs d ON d.id = i.design_id
    LEFT JOIN LATERAL (SELECT thumb_key FROM design_files WHERE design_id = d.id AND thumb_key IS NOT NULL LIMIT 1) df ON TRUE
    WHERE i.order_id IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})
  `)).rows as Record<string, unknown>[] : [];

  // Tất cả file (các mặt) của design đã gán → hiển thị đầy đủ
  const dIds = Array.from(new Set(items.map((i) => i.design_id).filter(Boolean))) as string[];
  const KIND_ORDER: Record<string, number> = { design_front: 0, design_back: 1, mockup: 2, video: 3 };
  const KIND_LABEL: Record<string, string> = { design_front: "Front", design_back: "Back", mockup: "Mockup", video: "Video" };
  const sidesMap: Record<string, { kind: string; label: string; thumb: string | null; original: string | null }[]> = {};
  if (dIds.length) {
    const fr = (await db.execute(sql`
      SELECT design_id, kind, thumb_key, preview_key, storage_key
      FROM design_files WHERE design_id IN (${sql.join(dIds.map((x) => sql`${x}::uuid`), sql`, `)})
    `)).rows as { design_id: string; kind: string; thumb_key: string | null; preview_key: string | null; storage_key: string | null }[];
    for (const r of fr) {
      (sidesMap[r.design_id] ??= []).push({ kind: r.kind, label: KIND_LABEL[r.kind] ?? r.kind, thumb: fileUrl(r.thumb_key ?? r.preview_key), original: fileUrl(r.storage_key) });
    }
    for (const k of Object.keys(sidesMap)) sidesMap[k].sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9));
  }

  // Gợi ý design cho item chưa gán — 3 tầng (listing → sku → tên), đơn custom thì không gợi ý.
  const need = items.filter((i) => !i.design_id);
  const suggestMap = await suggestForItems(need as never[]);

  // Đếm theo trạng thái — áp CÙNG bộ lọc (store/seller/marketplace/search/ngày) trừ chính status
  const countRows = await db.execute(sql`SELECT o.status, count(*)::int c FROM orders o WHERE ${baseWhere} GROUP BY o.status`);
  const counts: Record<string, number> = {};
  for (const r of countRows.rows as { status: string; c: number }[]) counts[r.status] = r.c;

  // Dropdown filter data
  const sellers = scopeIds ? [] : (await db.execute(sql`SELECT id, full_name AS name FROM users WHERE role='seller' ORDER BY full_name`)).rows;
  const storeFilter = scopeIds ? sql` WHERE seller_id IN (${sql.join(scopeIds.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``;
  // marketplace: để modal Import chỉ hiện store ĐÚNG SÀN (Etsy import không được chọn shop TikTok)
  const storesR = (await db.execute(sql`SELECT id, name, marketplace FROM stores${storeFilter} ORDER BY name`)).rows;
  const fulfillersR = (await db.execute(sql`SELECT id, name FROM fulfillers ORDER BY name`)).rows;

  const out = orders.map((o) => ({
    ...o,
    ...(hideCustomer ? { buyer_first: "***", buyer_last: "***", addr1: "***", addr2: null, city: "***", zip: "***" } : {}),
    items: items.filter((i) => i.order_id === o.id).map((i) => ({
      ...i,
      designThumb: fileUrl(i.design_thumb as string | null),
      designSides: i.design_id ? (sidesMap[i.design_id as string] ?? []) : [],
      mockupUrl: fileUrl(i.mockup_key as string | null),
      imageUrl: (i.image_url as string | null) ?? null,
      productUrl: (i.product_url as string | null) ?? null,
      variant: (i.variant as string | null) ?? null,
      ...(i.design_id ? { suggests: [], custom: false, baseDesign: null }
                      : (suggestMap.get(i.id as string) ?? { suggests: [], custom: false, baseDesign: null })),
    })),
  }));
  return NextResponse.json({ ok: true, total, page, show, counts, sellers, stores: storesR, fulfillers: fulfillersR, orders: out });
}

// POST /api/orders — tạo đơn tay
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b || !Array.isArray(b.items) || !b.items.length || !b.items.every((i: { productTitle?: string }) => i.productTitle)) {
    return NextResponse.json({ ok: false, error: "need at least 1 named product" }, { status: 400 });
  }
  const platform = (schema.orders.platform.enumValues as readonly string[]).includes(b.platform) ? b.platform : "etsy";
  const externalId = String(b.externalId ?? "").trim() || `MANUAL-${Date.now()}`;

  const scope = await resolveScope(session, "orders");
  const sellerId = scope === "all" ? (b.sellerId || null) : session.sub;

  const [order] = await db.insert(schema.orders).values({
    externalId, platform: platform as never,
    storeId: b.storeId || null, sellerId,
    status: "new", source: "manual",
    buyerFirst: b.buyerFirst ?? null, buyerLast: b.buyerLast ?? null,
    addr1: b.addr1 ?? null, addr2: b.addr2 ?? null, city: b.city ?? null,
    state: b.state ?? null, zip: b.zip ?? null, country: b.country || "United States",
    total: String(Number(b.total ?? 0).toFixed(2)), platformFee: String(Number(b.platformFee ?? 0).toFixed(2)),
    orderedAt: new Date(),
  }).returning();

  for (const it of b.items as { productTitle: string; internalSku?: string; qty?: number; unitPrice?: number }[]) {
    await db.insert(schema.orderItems).values({
      orderId: order.id, productTitle: String(it.productTitle).trim(),
      internalSku: it.internalSku?.trim() || null,
      qty: Number.isInteger(it.qty) && it.qty! >= 1 ? it.qty! : 1,
      unitPrice: String(Number(it.unitPrice ?? 0).toFixed(2)),
    });
  }
  return NextResponse.json({ ok: true, order });
}
