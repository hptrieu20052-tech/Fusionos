import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { scopeOwnerIds } from "@/lib/scope";
import { rangeCond } from "@/lib/ranges";

export const dynamic = "force-dynamic";

/**
 * v687 · GET /api/dashboard/channels?range=&from=&to=[&scope=self]
 * Khối "By channel" trên Dashboard — mỗi sàn 1 thẻ: Orders · Revenue · New listings · Fulfilled · Shops.
 *  - Orders/Revenue: đơn trong range (bỏ cancel/trash); Fulfilled = đơn ĐÃ có bản ghi đẩy nhà in
 *    (điều kiện phủ cả đơn bị GỘP ĐẨY v460 qua merged_order_ids). Scope seller theo seller_at_order
 *    y hệt /api/dashboard (scope=self → chỉ số của chính mình).
 *  - New listings: bản ghi listing TẠO trong range theo bảng từng sàn; Woo không có bảng listing → null.
 *    Scope self chỉ đếm được Shopify (created_by) + Etsy (store của mình), sàn khác → null.
 *  - Shops: store đang sống (status <> deleted) theo marketplace.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  // v690 · khối By channel CHỈ ADMIN (user chốt) — scope=self đã gỡ khỏi client, chặn luôn ở API.
  const self = false;
  if (session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const range = sp.get("range") ?? "30d";
  const from = sp.get("from"), to = sp.get("to");
  const cond = rangeCond("o.ordered_at", range, from, to);
  const scopeIds = self ? [session.sub] : await scopeOwnerIds(session, "orders");
  const inList = scopeIds ? sql.join(scopeIds.map((x) => sql`${x}::uuid`), sql`, `) : null;
  const own = inList ? sql` AND o.seller_at_order IN (${inList})` : sql``;

  const ordersRows = (await db.execute(sql`
    SELECT o.platform::text AS platform,
      count(*)::int AS orders,
      coalesce(sum(o.total),0)::numeric AS revenue,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM fulfillment_orders fo
        WHERE (fo.order_id = o.id OR (fo.merged_order_ids IS NOT NULL AND fo.merged_order_ids @> jsonb_build_array(o.id::text)))
          AND fo.status <> 'cancelled'
      ))::int AS fulfilled
    FROM orders o
    WHERE ${sql.raw(cond)} AND o.status NOT IN ('cancel','trash')${own}
    GROUP BY 1
  `)).rows as { platform: string; orders: number; revenue: string; fulfilled: number }[];

  // New listings theo bảng từng sàn — range áp lên created_at của bản ghi local.
  const lc = (col: string) => sql.raw(rangeCond(col, range, from, to));
  const listingSql = self
    ? sql`
      SELECT 'shopify' AS platform, count(*)::int AS n FROM shopify_products sp2 WHERE ${lc("sp2.created_at")} AND sp2.created_by = ${session.sub}::uuid
      UNION ALL
      SELECT 'etsy', count(*)::int FROM etsy_products ep JOIN stores s ON s.id = ep.store_id WHERE ${lc("ep.created_at")} AND s.seller_id = ${session.sub}::uuid`
    : sql`
      SELECT 'etsy' AS platform, count(*)::int AS n FROM etsy_products ep WHERE ${lc("ep.created_at")}
      UNION ALL SELECT 'tiktok', count(*)::int FROM tiktok_products tp WHERE ${lc("tp.created_at")}
      UNION ALL SELECT 'shopify', count(*)::int FROM shopify_products sp2 WHERE ${lc("sp2.created_at")}
      UNION ALL SELECT 'shopbase', count(*)::int FROM shopbase_products bp WHERE ${lc("bp.created_at")}
      UNION ALL SELECT 'amazon', count(*)::int FROM amazon_products ap WHERE ${lc("ap.created_at")}`;
  let listings: Record<string, number> = {};
  try {
    for (const r of (await db.execute(listingSql)).rows as { platform: string; n: number }[]) listings[r.platform] = r.n;
  } catch { listings = {}; /* bảng thiếu → ô New listings để trống, không chặn cả khối */ }

  // v690 · Shops LIVE theo THỜI GIAN THỰC — đúng định nghĩa badge LIVE trang Stores: có đơn 7 ngày gần nhất.
  const shopsRows = (await db.execute(sql`
    SELECT s.marketplace::text AS mk, count(*)::int AS n,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM orders o WHERE o.store_id = s.id AND o.ordered_at > NOW() - interval '7 days'
      ))::int AS live
    FROM stores s WHERE s.status <> 'deleted' GROUP BY 1
  `)).rows as { mk: string; n: number; live: number }[];
  const shops: Record<string, number> = {};
  const shopsLive: Record<string, number> = {};
  for (const r of shopsRows) { shops[r.mk] = r.n; shopsLive[r.mk] = r.live; }

  const ALL = ["tiktok", "etsy", "shopify", "woocommerce", "shopbase", "amazon"];
  const byP = new Map(ordersRows.map((r) => [r.platform, r] as const));
  const channels = ALL.map((p) => {
    const noListing = p === "woocommerce" || (self && p !== "shopify" && p !== "etsy");
    return {
      platform: p,
      orders: byP.get(p)?.orders ?? 0,
      revenue: Number(byP.get(p)?.revenue ?? 0),
      fulfilled: byP.get(p)?.fulfilled ?? 0,
      newListings: noListing ? null : (listings[p] ?? 0),
      shops: shops[p] ?? 0,
      shopsLive: shopsLive[p] ?? 0,
    };
  }).filter((c) => c.orders > 0 || c.shops > 0 || (c.newListings ?? 0) > 0);
  return NextResponse.json({ ok: true, channels });
}
