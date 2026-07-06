import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// GET ?days=30 — P&L từ bảng transactions (revenue dương, chi phí âm → SUM là ra)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "finance")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") ?? 30), 1), 92);

  const byType = await db.execute(sql`
    SELECT type, sum(amount) total FROM transactions
    WHERE occurred_at > CURRENT_DATE - (${days})::int GROUP BY 1 ORDER BY total
  `);
  const daily = await db.execute(sql`
    SELECT dd::date d,
      coalesce(sum(t.amount) FILTER (WHERE t.amount > 0),0) rev,
      coalesce(sum(t.amount) FILTER (WHERE t.amount < 0),0) cost
    FROM generate_series(CURRENT_DATE - (${days - 1})::int, CURRENT_DATE, '1 day') dd
    LEFT JOIN transactions t ON t.occurred_at = dd
    GROUP BY 1 ORDER BY 1
  `);
  const bySeller = await db.execute(sql`
    SELECT u.full_name name,
      sum(t.amount) FILTER (WHERE t.amount>0) rev,
      sum(t.amount) profit
    FROM transactions t JOIN users u ON u.id = t.seller_id
    WHERE t.occurred_at > CURRENT_DATE - (${days})::int
    GROUP BY 1 ORDER BY profit DESC NULLS LAST
  `);
  const byPlatform = await db.execute(sql`
    SELECT s.marketplace, sum(t.amount) profit, sum(t.amount) FILTER (WHERE t.amount>0) rev
    FROM transactions t JOIN stores s ON s.id = t.store_id
    WHERE t.occurred_at > CURRENT_DATE - (${days})::int
    GROUP BY 1 ORDER BY profit DESC
  `);

  return NextResponse.json({ ok: true, days, byType: byType.rows, daily: daily.rows, bySeller: bySeller.rows, byPlatform: byPlatform.rows });
}
