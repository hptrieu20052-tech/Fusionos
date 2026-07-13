import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf, hasRestriction } from "@/lib/rbac";
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

  // Tiền (Doanh thu / Fee / Lợi nhuận) + Sàn — chỉ cho người có quyền orders; ẩn lợi nhuận nếu bị hạn chế hide_profit.
  const showMoney = oLvl >= 1;
  const hideProfit = showMoney ? await hasRestriction(session, "hide_profit") : true;
  const money = { revenue: 0, fee: 0, cost: 0, profit: 0 };
  if (showMoney) {
    const mr = (await db.execute(sql`
      SELECT o.seller_id,
        coalesce(sum(o.total),0)::numeric AS revenue,
        coalesce(sum(o.platform_fee),0)::numeric AS fee,
        coalesce(sum(oc.cost),0)::numeric AS cost,
        array_agg(DISTINCT o.platform::text) AS platforms
      FROM orders o
      LEFT JOIN (
        SELECT order_id, -sum(amount) AS cost FROM transactions
        WHERE type IN ('base_cost','shipping','ads','sample') GROUP BY order_id
      ) oc ON oc.order_id = o.id
      WHERE ${sql.raw(cond)} AND o.status NOT IN ('cancel','trash') ${own}
      GROUP BY o.seller_id
    `)).rows as { seller_id: string | null; revenue: string; fee: string; cost: string; platforms: string[] }[];
    const mMap = new Map(mr.map((x) => [x.seller_id ?? "none", x]));
    for (const s of sellers) {
      const m = mMap.get(s.id ?? "none");
      const revenue = Number(m?.revenue ?? 0);
      const fee = Number(m?.fee ?? 0);
      const cost = Number(m?.cost ?? 0);
      const profit = revenue - fee - cost;
      (s as Record<string, unknown>).revenue = revenue;
      (s as Record<string, unknown>).fee = fee;
      (s as Record<string, unknown>).cost = cost; // chi phí fulfill (base cost + ship) gắn theo đơn
      (s as Record<string, unknown>).profit = hideProfit ? null : profit;
      (s as Record<string, unknown>).platforms = (m?.platforms ?? []).filter(Boolean);
      money.revenue += revenue; money.fee += fee; money.cost += cost; money.profit += profit;
    }
  }

  return NextResponse.json({ ok: true, range, buckets, sellers, totals, showMoney, hideProfit, money: showMoney ? { revenue: money.revenue, fee: money.fee, cost: money.cost, profit: hideProfit ? null : money.profit } : null });
}
