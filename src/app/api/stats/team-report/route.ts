import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { scopeOwnerIds } from "@/lib/scope";
import { rangeCond, isMonthly, bucketExprs } from "@/lib/ranges";

export const dynamic = "force-dynamic";

// GET ?range=... — doanh số theo TEAM (dựa trên team của seller sở hữu đơn)
// Trả: buckets, teams[{name, orders, items, revenue, members:[{name,role,orders,revenue}], daily:[{o,r}]}], totals
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const range = sp.get("range") ?? "this_month";
  const from = sp.get("from"), to = sp.get("to");
  const cond = rangeCond("o.ordered_at", range, from, to);
  const { bucketExpr, bucketOrd } = bucketExprs("o.ordered_at", isMonthly(range, from, to));

  // Phạm vi: team/own → chỉ đơn trong phạm vi (→ chỉ team của mình hiện ra)
  const scopeIds = await scopeOwnerIds(session, "orders");
  const inO = scopeIds ? sql` AND o.seller_id IN (${sql.join(scopeIds.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``;

  const r = await db.execute(sql`
    SELECT ${sql.raw(bucketExpr)} AS bucket, min(${sql.raw(bucketOrd)}) AS ord,
           coalesce(u.team,'(chưa gán team)') AS team,
           count(*)::int AS o, coalesce(sum(oi.qty),0)::int AS i, coalesce(sum(o.total),0)::numeric AS r
    FROM orders o
    LEFT JOIN users u ON u.id = o.seller_id
    LEFT JOIN (SELECT order_id, sum(qty) qty FROM order_items GROUP BY 1) oi ON oi.order_id = o.id
    WHERE ${sql.raw(cond)} AND o.status NOT IN ('cancel','trash')${inO}
    GROUP BY 1, u.team ORDER BY ord
  `);
  const rows = r.rows as { bucket: string; team: string; o: number; i: number; r: string }[];

  // Thành viên đóng góp trong kỳ theo team
  const mem = await db.execute(sql`
    SELECT coalesce(u.team,'(chưa gán team)') AS team, u.full_name AS name, u.role,
           count(o.id)::int AS orders, coalesce(sum(o.total),0)::numeric AS revenue
    FROM orders o JOIN users u ON u.id = o.seller_id
    WHERE ${sql.raw(cond)} AND o.status NOT IN ('cancel','trash')${inO}
    GROUP BY 1, u.full_name, u.role ORDER BY revenue DESC
  `);

  const buckets = Array.from(new Map(rows.map((x) => [x.bucket, true])).keys());
  const bIdx = new Map(buckets.map((b, i) => [b, i]));
  const tmap = new Map<string, { name: string; orders: number; items: number; revenue: number; members: { name: string; role: string; orders: number; revenue: number }[]; daily: { o: number; r: number }[] }>();
  for (const x of rows) {
    if (!tmap.has(x.team)) tmap.set(x.team, { name: x.team, orders: 0, items: 0, revenue: 0, members: [], daily: buckets.map(() => ({ o: 0, r: 0 })) });
    const t = tmap.get(x.team)!;
    t.orders += x.o; t.items += x.i; t.revenue += Number(x.r);
    t.daily[bIdx.get(x.bucket)!] = { o: x.o, r: Number(x.r) };
  }
  for (const m of mem.rows as { team: string; name: string; role: string; orders: number; revenue: string }[]) {
    tmap.get(m.team)?.members.push({ name: m.name, role: m.role, orders: m.orders, revenue: Number(m.revenue) });
  }
  const teams = Array.from(tmap.values())
    .map((t) => ({ ...t, revenue: Number(t.revenue.toFixed(2)), aov: t.orders ? Number((t.revenue / t.orders).toFixed(2)) : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
  const totals = {
    orders: teams.reduce((a, t) => a + t.orders, 0),
    items: teams.reduce((a, t) => a + t.items, 0),
    revenue: Number(teams.reduce((a, t) => a + t.revenue, 0).toFixed(2)),
  };
  return NextResponse.json({ ok: true, range, buckets, teams, totals });
}
