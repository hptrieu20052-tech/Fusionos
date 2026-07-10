import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { scopeOwnerIds } from "@/lib/scope";
import { rangeCond, isMonthly, bucketExprs } from "@/lib/ranges";

export const dynamic = "force-dynamic";

// GET ?range=today|yesterday|7d|this_month|last_month|this_year|all
// Trả về: buckets (ngày hoặc tháng), sellers[{id,name,orders,items,daily:[{o,i}]}], totals
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  // Báo cáo seller chỉ có SỐ đơn/items (không có tiền) → cho mọi người xem được Dashboard (orders hoặc designs)
  const [oLvl, dLvl] = await Promise.all([levelOf(session, "orders"), levelOf(session, "designs")]);
  if (oLvl < 1 && dLvl < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const range = sp.get("range") ?? "7d";
  const from = sp.get("from"), to = sp.get("to");
  const cond = rangeCond("o.ordered_at", range, from, to);
  const { bucketExpr, bucketOrd } = bucketExprs("o.ordered_at", isMonthly(range, from, to));

  const _si = await scopeOwnerIds(session, "dashboard");
  const own = _si ? sql` AND o.seller_id IN (${sql.join(_si.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``;

  const r = await db.execute(sql`
    SELECT ${sql.raw(bucketExpr)} AS bucket, min(${sql.raw(bucketOrd)}) AS ord,
           o.seller_id, coalesce(u.full_name,'(chưa gán)') AS name,
           count(*)::int AS o, coalesce(sum(oi.qty),0)::int AS i
    FROM orders o
    LEFT JOIN users u ON u.id = o.seller_id
    LEFT JOIN (SELECT order_id, sum(qty) qty FROM order_items GROUP BY 1) oi ON oi.order_id = o.id
    WHERE ${sql.raw(cond)} AND o.status NOT IN ('cancel','trash') ${own}
    GROUP BY 1, o.seller_id, u.full_name
    ORDER BY ord
  `);
  const rows = r.rows as { bucket: string; seller_id: string | null; name: string; o: number; i: number }[];

  const buckets = Array.from(new Map(rows.map((x) => [x.bucket, true])).keys());
  const bIdx = new Map(buckets.map((b, ix) => [b, ix]));
  const sellersMap = new Map<string, { id: string | null; name: string; orders: number; items: number; daily: { o: number; i: number }[] }>();
  for (const x of rows) {
    const key = x.seller_id ?? "none";
    if (!sellersMap.has(key)) sellersMap.set(key, { id: x.seller_id, name: x.name, orders: 0, items: 0, daily: buckets.map(() => ({ o: 0, i: 0 })) });
    const s = sellersMap.get(key)!;
    s.orders += x.o; s.items += x.i;
    s.daily[bIdx.get(x.bucket)!] = { o: x.o, i: x.i };
  }
  const sellers = Array.from(sellersMap.values()).sort((a, b) => b.orders - a.orders);
  const totals = { orders: sellers.reduce((a, s) => a + s.orders, 0), items: sellers.reduce((a, s) => a + s.items, 0) };

  return NextResponse.json({ ok: true, range, buckets, sellers, totals });
}
