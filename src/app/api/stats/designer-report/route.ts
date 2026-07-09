import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { scopeOwnerIds } from "@/lib/scope";
import { rangeCond, isMonthly, bucketExprs } from "@/lib/ranges";

export const dynamic = "force-dynamic";

// GET ?range=today|yesterday|7d|this_month|last_month|this_year|all
// Mỗi designer: design/ngày (stacked), sale phát sinh từ design của họ (đơn + doanh thu),
// điểm review TB trong kỳ, KPI tổng hợp 40/30/30 → xếp hạng.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const range = sp.get("range") ?? "this_month";
  const from = sp.get("from"), to = sp.get("to");
  const monthly = isMonthly(range, from, to);
  const cond = (col: string) => rangeCond(col, range, from, to);
  const bucket = (col: string) => bucketExprs(col, monthly).bucketExpr;
  const bucketOrd = (col: string) => bucketExprs(col, monthly).bucketOrd;

  // Phạm vi: team/own → chỉ designer trong phạm vi
  const scopeIds = await scopeOwnerIds(session, "designs");
  const inD = scopeIds ? sql` AND d.designer_id IN (${sql.join(scopeIds.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``;

  // 1. Design tạo trong kỳ theo designer × bucket (kèm points cho KPI)
  const dz = await db.execute(sql`
    SELECT ${sql.raw(bucket("d.created_at"))} AS bucket, min(${sql.raw(bucketOrd("d.created_at"))}) AS ord,
           d.designer_id, coalesce(u.full_name,'(chưa gán)') AS name,
           count(*)::int AS c, coalesce(sum(d.points),0)::int AS pts
    FROM designs d LEFT JOIN users u ON u.id = d.designer_id
    WHERE ${sql.raw(cond("d.created_at"))} AND d.designer_id IS NOT NULL${inD}
    GROUP BY 1, d.designer_id, u.full_name ORDER BY ord
  `);
  // 2. Sale phát sinh trong kỳ từ design của designer × bucket
  const sales = await db.execute(sql`
    SELECT ${sql.raw(bucket("o.ordered_at"))} AS bucket, min(${sql.raw(bucketOrd("o.ordered_at"))}) AS ord,
           d.designer_id,
           count(DISTINCT o.id)::int AS orders, coalesce(sum(oi.qty * oi.unit_price),0)::numeric AS revenue
    FROM order_items oi
    JOIN designs d ON d.id = oi.design_id AND d.designer_id IS NOT NULL
    JOIN orders o ON o.id = oi.order_id
    WHERE ${sql.raw(cond("o.ordered_at"))} AND o.status NOT IN ('cancel','trash')${inD}
    GROUP BY 1, d.designer_id ORDER BY ord
  `);
  // 3. Điểm review trong kỳ theo designer
  const scores = await db.execute(sql`
    SELECT d.designer_id, avg(r.total_score)::numeric(4,2) AS score, count(*)::int AS reviews
    FROM design_reviews r JOIN designs d ON d.id = r.design_id
    WHERE ${sql.raw(cond("r.created_at"))} AND d.designer_id IS NOT NULL${inD}
    GROUP BY 1
  `);

  type DzRow = { bucket: string; ord: string; designer_id: string; name: string; c: number; pts: number };
  type SaleRow = { bucket: string; ord: string; designer_id: string; orders: number; revenue: string };
  const dzRows = dz.rows as DzRow[];
  const saleRows = sales.rows as SaleRow[];

  // Buckets = hợp 2 nguồn, sắp theo thời gian
  const bmap = new Map<string, string>();
  for (const r of [...dzRows, ...saleRows]) if (!bmap.has(r.bucket) || r.ord < bmap.get(r.bucket)!) bmap.set(r.bucket, r.ord);
  const buckets = Array.from(bmap.entries()).sort((a, b) => a[1] < b[1] ? -1 : 1).map(([b]) => b);
  const bIdx = new Map(buckets.map((b, i) => [b, i]));

  const dmap = new Map<string, { id: string; name: string; designs: number; points: number; salesOrders: number; salesRevenue: number; avgScore: number; reviews: number; daily: { d: number; s: number }[] }>();
  const ensure = (id: string, name?: string) => {
    if (!dmap.has(id)) dmap.set(id, { id, name: name ?? "", designs: 0, points: 0, salesOrders: 0, salesRevenue: 0, avgScore: 0, reviews: 0, daily: buckets.map(() => ({ d: 0, s: 0 })) });
    return dmap.get(id)!;
  };
  for (const r of dzRows) { const x = ensure(r.designer_id, r.name); x.name = r.name; x.designs += r.c; x.points += r.pts; x.daily[bIdx.get(r.bucket)!].d = r.c; }
  for (const r of saleRows) { const x = ensure(r.designer_id); x.salesOrders += r.orders; x.salesRevenue += Number(r.revenue); x.daily[bIdx.get(r.bucket)!].s = r.orders; }
  for (const r of scores.rows as { designer_id: string; score: string; reviews: number }[]) {
    const x = dmap.get(r.designer_id); if (x) { x.avgScore = Number(r.score); x.reviews = r.reviews; }
  }
  // Bổ sung tên cho designer chỉ có sale (không có design mới trong kỳ)
  const missing = Array.from(dmap.values()).filter((x) => !x.name).map((x) => x.id);
  if (missing.length) {
    const names = await db.execute(sql`SELECT id, full_name FROM users WHERE id = ANY(${missing}::uuid[])`);
    for (const n of names.rows as { id: string; full_name: string }[]) { const x = dmap.get(n.id); if (x) x.name = n.full_name; }
  }

  // KPI 40/30/30: sản lượng (points chuẩn hoá) · chất lượng (điểm review, mặc định 5 nếu chưa chấm) · kinh doanh (đơn phát sinh chuẩn hoá)
  const list = Array.from(dmap.values());
  const maxPts = Math.max(...list.map((x) => x.points), 1);
  const maxBiz = Math.max(...list.map((x) => x.salesOrders), 1);
  const designers = list.map((x) => ({
    ...x,
    salesRevenue: Number(x.salesRevenue.toFixed(2)),
    kpi: Number(((x.points / maxPts) * 10 * 0.4 + (x.avgScore || 5) * 0.3 + (x.salesOrders / maxBiz) * 10 * 0.3).toFixed(1)),
  })).sort((a, b) => b.kpi - a.kpi);

  const totals = {
    designs: designers.reduce((a, x) => a + x.designs, 0),
    salesOrders: designers.reduce((a, x) => a + x.salesOrders, 0),
    salesRevenue: Number(designers.reduce((a, x) => a + x.salesRevenue, 0).toFixed(2)),
  };
  return NextResponse.json({ ok: true, range, buckets, designers, totals });
}
