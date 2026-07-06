import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// GET ?days=7 — designer × ngày (design hoàn thành) + điểm review + đơn phát sinh 30d
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") ?? 7), 1), 31);

  const daily = await db.execute(sql`
    SELECT u.id designer_id, u.full_name name, d.created_at::date dd, count(*)::int v, coalesce(sum(d.points),0)::int pts
    FROM designs d JOIN users u ON u.id = d.designer_id
    WHERE d.created_at > CURRENT_DATE - (${days - 1})::int
    GROUP BY 1,2,3
  `);
  const scores = await db.execute(sql`
    SELECT d.designer_id, round(avg(r.quality_score),1) score, count(r.id)::int reviews
    FROM design_reviews r JOIN designs d ON d.id = r.design_id
    WHERE d.designer_id IS NOT NULL GROUP BY 1
  `);
  const biz = await db.execute(sql`
    SELECT d.designer_id, count(DISTINCT oi.order_id)::int orders
    FROM order_items oi JOIN designs d ON d.id = oi.design_id
    JOIN orders o ON o.id = oi.order_id
    WHERE o.ordered_at > NOW() - interval '30 days' AND d.designer_id IS NOT NULL
    GROUP BY 1
  `);

  const dayList: string[] = [];
  for (let i = days - 1; i >= 0; i--) { const dt = new Date(); dt.setDate(dt.getDate() - i); dayList.push(dt.toISOString().slice(0, 10)); }

  const rows = daily.rows as { designer_id: string; name: string; dd: string; v: number; pts: number }[];
  const smap = new Map((scores.rows as { designer_id: string; score: string; reviews: number }[]).map((x) => [x.designer_id, x]));
  const bmap = new Map((biz.rows as { designer_id: string; orders: number }[]).map((x) => [x.designer_id, x.orders]));

  const designers = Array.from(new Map(rows.map((x) => [x.designer_id, x.name])).entries()).map(([id, name]) => {
    const values = dayList.map((d) => rows.filter((x) => x.designer_id === id && String(x.dd).slice(0, 10) === d).reduce((t, x) => t + x.v, 0));
    const points = rows.filter((x) => x.designer_id === id).reduce((t, x) => t + x.pts, 0);
    const total = values.reduce((a, b) => a + b, 0);
    return {
      id, name, values, total, points,
      avgScore: Number(smap.get(id)?.score ?? 0), reviews: smap.get(id)?.reviews ?? 0,
      bizOrders: bmap.get(id) ?? 0,
    };
  });
  const maxOut = Math.max(...designers.map((d) => d.points), 1);
  const maxBiz = Math.max(...designers.map((d) => d.bizOrders), 1);
  const out = designers.map((d) => ({
    ...d,
    kpi: Number(((d.points / maxOut) * 10 * 0.4 + (d.avgScore || 5) * 0.3 + (d.bizOrders / maxBiz) * 10 * 0.3).toFixed(1)),
  })).sort((a, b) => b.kpi - a.kpi);

  return NextResponse.json({ ok: true, days: dayList, designers: out });
}
