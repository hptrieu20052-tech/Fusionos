import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { scopeOwnerIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

// GET ?days=7&metric=orders|items — ma trận seller × ngày
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  let days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") ?? 7), 1), 31);
  // Range tuỳ chọn ?from&to (DateRangePicker) — ưu tiên hơn days; giới hạn 92 ngày
  const dOk = (x: string | null) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const fromQ = dOk(req.nextUrl.searchParams.get("from"));
  const toQ = dOk(req.nextUrl.searchParams.get("to"));
  const useRange = !!(fromQ && toQ);
  if (useRange) days = Math.min(Math.max(Math.round((Date.parse(toQ!) - Date.parse(fromQ!)) / 86400000) + 1, 1), 92);
  const FROM = useRange ? sql`${fromQ}::date` : sql`CURRENT_DATE - (${days - 1})::int`;
  const TO = useRange ? sql`${toQ}::date` : sql`CURRENT_DATE`;
  const metric = req.nextUrl.searchParams.get("metric") === "items" ? "items" : "orders";
  const _si = await scopeOwnerIds(session, "orders");
  const inO = _si ? sql` AND o.seller_id IN (${sql.join(_si.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``;

  const val = metric === "items" ? sql`coalesce(sum(oi.qty),0)::int` : sql`count(DISTINCT o.id)::int`;
  const r = await db.execute(sql`
    SELECT u.id seller_id, u.full_name seller, o.ordered_at::date d, ${val} v
    FROM orders o
    JOIN users u ON u.id = o.seller_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.ordered_at::date >= ${FROM} AND o.ordered_at::date <= ${TO} AND o.status NOT IN ('cancel','trash')${inO}
    GROUP BY 1,2,3 ORDER BY 3
  `);
  const dayList: string[] = [];
  const anchor = useRange ? new Date(toQ! + "T00:00:00Z") : new Date();
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(anchor); dt.setDate(dt.getDate() - i);
    dayList.push(dt.toISOString().slice(0, 10));
  }
  const rows = r.rows as { seller_id: string; seller: string; d: string; v: number }[];
  const sellers = Array.from(new Map(rows.map((x) => [x.seller_id, x.seller])).entries()).map(([id, name]) => ({ id, name }));
  const matrix = sellers.map((s) => ({
    ...s,
    values: dayList.map((d) => rows.find((x) => x.seller_id === s.id && String(x.d).slice(0, 10) === d)?.v ?? 0),
  })).map((s) => ({ ...s, total: s.values.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({ ok: true, days: dayList, metric, sellers: matrix, scoped: !!_si });
}
