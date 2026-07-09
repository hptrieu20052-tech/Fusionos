import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf, hasRestriction } from "@/lib/rbac";
import { rangeCond } from "@/lib/ranges";

export const dynamic = "force-dynamic";

// GET /api/dashboard?range=&from=&to= — KPI đầu trang theo range chung
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const range = sp.get("range") ?? "today";
  const from = sp.get("from"), to = sp.get("to");
  const cond = rangeCond("o.ordered_at", range, from, to);
  const ownFlag = await hasRestriction(session, "own_orders_only");
  const own = ownFlag ? sql` AND o.seller_id = ${session.sub}` : sql``;
  const ownItems = ownFlag ? sql` AND o2.seller_id = ${session.sub}` : sql``;

  // Kỳ trước cùng độ dài để tính delta (chỉ cho các range đơn giản)
  const prevCond: string | null = ({
    today: "o.ordered_at::date = CURRENT_DATE - 1",
    yesterday: "o.ordered_at::date = CURRENT_DATE - 2",
    "3d": "o.ordered_at::date BETWEEN CURRENT_DATE - 5 AND CURRENT_DATE - 3",
    "7d": "o.ordered_at::date BETWEEN CURRENT_DATE - 13 AND CURRENT_DATE - 7",
    "30d": "o.ordered_at::date BETWEEN CURRENT_DATE - 59 AND CURRENT_DATE - 30",
    this_month: "date_trunc('month', o.ordered_at) = date_trunc('month', CURRENT_DATE) - interval '1 month'",
    last_month: "date_trunc('month', o.ordered_at) = date_trunc('month', CURRENT_DATE) - interval '2 month'",
    this_year: "date_trunc('year', o.ordered_at) = date_trunc('year', CURRENT_DATE) - interval '1 year'",
  } as Record<string, string>)[range] ?? null;

  const [cur] = (await db.execute(sql`
    SELECT count(*)::int o, coalesce(sum(o.total),0)::numeric r,
      coalesce((SELECT sum(oi.qty) FROM order_items oi JOIN orders o2 ON o2.id=oi.order_id
        WHERE ${sql.raw(cond.replace("o.ordered_at","o2.ordered_at"))} AND o2.status NOT IN ('cancel','trash')${ownItems}),0)::int items
    FROM orders o WHERE ${sql.raw(cond)} AND o.status NOT IN ('cancel','trash')${own}
  `)).rows as { o: number; r: string; items: number }[];

  let prev: { o: number; r: string } | null = null;
  if (prevCond) {
    prev = ((await db.execute(sql`
      SELECT count(*)::int o, coalesce(sum(o.total),0)::numeric r
      FROM orders o WHERE ${sql.raw(prevCond)} AND o.status NOT IN ('cancel','trash')${own}
    `)).rows as { o: number; r: string }[])[0];
  }

  const [misc] = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM orders o WHERE o.status = 'new'${own})::int AS pending_new,
      (SELECT count(*) FROM orders o WHERE o.status = 'has_issues'${own})::int AS issues,
      (SELECT count(*) FROM designs d WHERE ${sql.raw(rangeCond("d.created_at", range, from, to))})::int AS designs
  `)).rows as { pending_new: number; issues: number; designs: number }[];

  // Dự toán lợi nhuận trong kỳ = doanh thu - phí sàn - giá vốn (từ transactions)
  const own2 = (await hasRestriction(session, "own_orders_only")) ? sql` AND o2.seller_id = ${session.sub}` : sql``;
  const [pnl] = (await db.execute(sql`
    SELECT
      coalesce(sum(o.total),0)::numeric AS revenue,
      coalesce(sum(o.platform_fee),0)::numeric AS fee,
      coalesce((SELECT -sum(t.amount) FROM transactions t
        JOIN orders o2 ON o2.id = t.order_id
        WHERE t.type IN ('base_cost','shipping','ads','sample')
          AND ${sql.raw(cond.replace("o.ordered_at","o2.ordered_at"))}
          AND o2.status NOT IN ('cancel','trash')${own2}),0) AS cost
    FROM orders o WHERE ${sql.raw(cond)} AND o.status NOT IN ('cancel','trash')${own}
  `)).rows as { revenue: string; fee: string; cost: string }[];
  const profit = Number(pnl.revenue) - Number(pnl.fee) - Number(pnl.cost);

  // nhãn kỳ so sánh theo range
  const prevLabel = ({ today: "hôm qua", yesterday: "hôm kia", "3d": "3 ngày trước", "7d": "tuần trước", "30d": "30 ngày trước", this_month: "tháng trước", last_month: "tháng trước đó", this_year: "năm trước" } as Record<string, string>)[range] ?? "kỳ trước";

  // Pipeline theo trạng thái trong kỳ: In production / In Transit (shipped) / Delivered (completed)
  const pipeRows = (await db.execute(sql`
    SELECT o.status,
      count(DISTINCT o.id)::int c,
      coalesce(sum(oi.qty),0)::int q
    FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE ${sql.raw(cond)} AND o.status IN ('in_production','shipped','completed')${own}
    GROUP BY o.status
  `)).rows as { status: string; c: number; q: number }[];
  const pick = (s: string) => { const r = pipeRows.find((x) => x.status === s); return { c: r?.c ?? 0, q: r?.q ?? 0 }; };
  const pipeline = {
    order: { c: cur.o, q: cur.items, prev: prev ? prev.o : null },
    in_production: pick("in_production"),
    in_transit: pick("shipped"),
    delivered: pick("completed"),
  };

  return NextResponse.json({
    ok: true,
    orders: cur.o, items: cur.items, revenue: Number(cur.r), prevLabel,
    prevOrders: prev ? prev.o : null, prevRevenue: prev ? Number(prev.r) : null,
    pendingNew: misc.pending_new, issues: misc.issues, designs: misc.designs,
    pipeline,
    profit, profitRevenue: Number(pnl.revenue), profitFee: Number(pnl.fee), profitCost: Number(pnl.cost),
  });
}
