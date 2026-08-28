import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/product-sales — SALE theo LISTING/PRODUCT (không phải theo design id).
 *
 * Sách customized: mỗi đơn 1 file riêng, nhiều đơn KHÔNG gán design_id → thống kê theo design bỏ sót.
 * Ở đây gộp theo LISTING (order_items.etsy_listing_id — Etsy listing_id / TikTok product_id; 1 listing =
 * 1 sản phẩm), fallback theo tên sản phẩm khi thiếu listing_id. → đếm đúng "listing này bán bao nhiêu"
 * để ưu tiên mẫu chạy ads.
 *
 * Query: q (tìm theo tên/listing_id) · days=365 | from/to · platform · sort=orders|qty|revenue|recent
 *        · limit(≤200)/offset. Tiền chỉ trả cho admin.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const isAdmin = session.role === "admin";
  if (!isAdmin && (await levelOf(session, "products")) < 1 && (await levelOf(session, "orders")) < 1)
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const dOk = (x: string | null) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const fromQ = dOk(sp.get("from"));
  const toQ = dOk(sp.get("to"));
  const useRange = !!(fromQ && toQ);
  const days = Math.min(Math.max(Number(sp.get("days") ?? 365), 1), 1096);
  const FROM = useRange ? sql`${fromQ}::date` : sql`CURRENT_DATE - (${days - 1})::int`;
  const TO = useRange ? sql`${toQ}::date` : sql`CURRENT_DATE`;

  const q = (sp.get("q") ?? "").trim().slice(0, 120);
  const platform = (sp.get("platform") ?? "").trim();
  let sort = ["orders", "qty", "revenue", "recent"].includes(sp.get("sort") ?? "") ? sp.get("sort")! : "orders";
  if (!isAdmin && sort === "revenue") sort = "orders";
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50), 1), 200);
  const offset = Math.max(Number(sp.get("offset") ?? 0), 0);

  // Scope: SELLER chỉ thấy product của mình, ADMIN thấy hết. storeOwnerScopeIds ÉP seller = own store
  // (kể cả khi chưa seed scope), admin/role khác → all. Khớp theo chủ shop lúc đơn về (seller_at_order).
  const ownIds = await storeOwnerScopeIds(session);
  const conds = [
    sql`o.status NOT IN ('new','cancel','trash')`,
    sql`o.ordered_at::date >= ${FROM}`,
    sql`o.ordered_at::date <= ${TO}`,
  ];
  if (ownIds) {
    if (!ownIds.length) return NextResponse.json({ ok: true, showMoney: isAdmin, total: 0, rows: [] });
    conds.push(sql`o.seller_at_order IN (${sql.join(ownIds.map((x) => sql`${x}::uuid`), sql`, `)})`);
  }
  if (platform) conds.push(sql`o.platform = ${platform}::marketplace`);
  if (q) {
    const like = "%" + q + "%";
    conds.push(sql`(oi.product_title ILIKE ${like} OR oi.etsy_listing_id = ${q})`);
  }
  const WHERE = sql.join(conds, sql` AND `);

  // listing_key: ưu tiên listing_id thật; thiếu thì gộp theo tên sản phẩm (chuẩn hoá thường + trim).
  const LKEY = sql`COALESCE(NULLIF(oi.etsy_listing_id, ''), 'T:' || lower(btrim(oi.product_title)))`;

  const ORDER =
    sort === "recent" ? sql`last_order DESC NULLS LAST` :
    sort === "qty" ? sql`qty DESC, orders DESC` :
    sort === "revenue" ? sql`revenue DESC, orders DESC` :
    sql`orders DESC, qty DESC`;

  const rows = (await db.execute(sql`
    SELECT
      ${LKEY} AS listing_key,
      count(DISTINCT oi.order_id)::int AS orders,
      coalesce(sum(oi.qty), 0)::int AS qty,
      coalesce(sum(oi.qty * oi.unit_price), 0)::numeric(14,2) AS revenue,
      max(o.ordered_at) AS last_order,
      string_agg(DISTINCT o.platform::text, ',') AS platforms,
      (array_agg(oi.product_title ORDER BY o.ordered_at DESC))[1] AS title,
      (array_agg(oi.product_url ORDER BY o.ordered_at DESC) FILTER (WHERE oi.product_url IS NOT NULL))[1] AS product_url,
      (array_agg(NULLIF(oi.etsy_listing_id,'') ORDER BY o.ordered_at DESC) FILTER (WHERE NULLIF(oi.etsy_listing_id,'') IS NOT NULL))[1] AS listing_id,
      (array_agg(oi.image_url ORDER BY o.ordered_at DESC) FILTER (WHERE oi.image_url IS NOT NULL))[1] AS image_url,
      (array_agg(oi.mockup_key ORDER BY o.ordered_at DESC) FILTER (WHERE oi.mockup_key IS NOT NULL))[1] AS mockup_key,
      (array_agg(oi.design_id ORDER BY o.ordered_at DESC) FILTER (WHERE oi.design_id IS NOT NULL))[1] AS base_design_id
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE ${WHERE}
    GROUP BY ${LKEY}
    ORDER BY ${ORDER}
    LIMIT ${limit} OFFSET ${offset}
  `)).rows as {
    listing_key: string; orders: number; qty: number; revenue: string; last_order: string | null;
    platforms: string | null; title: string | null; product_url: string | null; listing_id: string | null;
    image_url: string | null; mockup_key: string | null; base_design_id: string | null;
  }[];

  const [{ total }] = (await db.execute(sql`
    SELECT count(*)::int AS total FROM (
      SELECT ${LKEY} AS k FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE ${WHERE} GROUP BY ${LKEY}
    ) z
  `)).rows as { total: number }[];

  // Base design (design gốc hay được gán cho listing) → sku_code + tên + thumb, để hiện "Base #".
  const bIds = Array.from(new Set(rows.map((r) => r.base_design_id).filter(Boolean))) as string[];
  const baseBy = new Map<string, { sku: number; title: string; thumb: string | null }>();
  if (bIds.length) {
    const dr = (await db.execute(sql`
      SELECT d.id, d.sku_code, d.title,
             (SELECT thumb_key FROM design_files f WHERE f.design_id = d.id AND f.kind <> 'video'
                AND coalesce(f.filename,'') NOT ILIKE '%.dst' ORDER BY (f.kind='design_front') DESC, (f.kind='mockup') DESC, f.created_at ASC LIMIT 1) AS thumb_key
      FROM designs d WHERE d.id IN (${sql.join(bIds.map((x) => sql`${x}::uuid`), sql`, `)})
    `)).rows as { id: string; sku_code: number; title: string; thumb_key: string | null }[];
    for (const d of dr) baseBy.set(d.id, { sku: d.sku_code, title: d.title, thumb: fileUrl(d.thumb_key) });
  }

  return NextResponse.json({
    ok: true, showMoney: isAdmin, total,
    rows: rows.map((r) => {
      const base = r.base_design_id ? baseBy.get(r.base_design_id) : undefined;
      const img = (r.image_url && /^https?:\/\//i.test(r.image_url)) ? r.image_url : (fileUrl(r.mockup_key) ?? base?.thumb ?? null);
      return {
        listingKey: r.listing_key,
        title: r.title ?? "(no title)",
        listingId: r.listing_id,
        productUrl: r.product_url,
        image: img,
        orders: Number(r.orders), qty: Number(r.qty),
        revenue: isAdmin ? Number(r.revenue) : null,
        lastOrder: r.last_order,
        platforms: (r.platforms ?? "").split(",").map((x) => x.trim()).filter(Boolean),
        baseSku: base?.sku ?? null,
      };
    }),
  });
}
