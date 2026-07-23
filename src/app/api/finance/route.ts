import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { scopeOwnerIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * GET ?days=30 | ?from&to — P&L:
 *  - REVENUE + PLATFORM FEE: tính TRỰC TIẾP từ bảng orders (ordered_at, loại cancel/trash)
 *    → luôn khớp thực tế, không phụ thuộc bút toán tay; cancel tự rơi khỏi doanh thu.
 *  - COST: từ transactions (base_cost do push/webhook ghi = GIÁ THẬT nhà in; ads/salary... nhập tay).
 *  - PROFIT = revenue − fee + Σcost(âm).
 * PHÂN QUYỀN: admin/level finance cao → toàn công ty; SELLER chỉ thấy số của CHÍNH MÌNH
 * (lọc orders.seller_id + transactions.seller_id theo scope).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const lvl = await levelOf(session, "finance");
  if (lvl < 1 && session.role !== "seller") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // Scope: admin → tất cả; còn lại theo role_data_scopes; seller không cấu hình scope → ép về CHÍNH MÌNH
  let ownerIds: string[] | null = null;
  if (session.role !== "admin") {
    ownerIds = await scopeOwnerIds(session, "orders").catch(() => null); // dùng scope orders (finance chưa có scope riêng)
    if (!ownerIds && session.role === "seller") ownerIds = [session.sub];
  }
  const inSeller = ownerIds ? sql` AND o.seller_id IN (${sql.join(ownerIds.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``;
  const inTxSeller = ownerIds ? sql` AND t.seller_id IN (${sql.join(ownerIds.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``;

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") ?? 30), 1), 92);
  const dOk = (x: string | null) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const fromQ = dOk(req.nextUrl.searchParams.get("from"));
  const toQ = dOk(req.nextUrl.searchParams.get("to"));
  const useRange = !!(fromQ && toQ);
  const FROM = useRange ? sql`${fromQ}::date` : sql`CURRENT_DATE - (${days - 1})::int`;
  const TO = useRange ? sql`${toQ}::date` : sql`CURRENT_DATE`;

  // Đơn tính doanh thu: trong range, không cancel/trash
  const ordersWhere = sql`o.ordered_at::date >= ${FROM} AND o.ordered_at::date <= ${TO} AND o.status NOT IN ('cancel','trash')${inSeller}`;

  const [totals, byType, dailyRev, dailyCost, bySeller, byStore, byPlatform, bySupplier] = await Promise.all([
    // Tổng revenue + fee từ orders
    db.execute(sql`
      SELECT coalesce(sum(o.total),0) revenue, coalesce(sum(o.platform_fee),0) fee, count(*)::int orders
      FROM orders o WHERE ${ordersWhere}`),
    // Cost theo type (transactions âm; bút toán 'revenue' nhập tay vẫn cộng vào doanh thu qua totals riêng)
    db.execute(sql`
      SELECT type, sum(amount) total FROM transactions t
      WHERE t.occurred_at >= ${FROM} AND t.occurred_at <= ${TO}${inTxSeller}
      GROUP BY 1 ORDER BY total`),
    db.execute(sql`
      SELECT o.ordered_at::date d, sum(o.total) rev, sum(o.platform_fee) fee
      FROM orders o WHERE ${ordersWhere} GROUP BY 1`),
    db.execute(sql`
      SELECT t.occurred_at d, sum(t.amount) FILTER (WHERE t.type <> 'revenue') cost
      FROM transactions t WHERE t.occurred_at >= ${FROM} AND t.occurred_at <= ${TO}${inTxSeller} GROUP BY 1`),
    // Theo SELLER: rev/fee từ orders + cost từ transactions
    db.execute(sql`
      SELECT u.id, u.full_name name,
        coalesce(sum(o.total),0) rev, coalesce(sum(o.platform_fee),0) fee,
        coalesce((SELECT sum(t.amount) FROM transactions t
          WHERE t.seller_id = u.id AND t.type <> 'revenue' AND t.occurred_at >= ${FROM} AND t.occurred_at <= ${TO}),0) cost
      FROM orders o JOIN users u ON u.id = o.seller_id
      WHERE ${ordersWhere}
      GROUP BY 1,2 ORDER BY rev DESC`),
    // THEO STORE (chi tiết store của seller): store + marketplace + seller
    db.execute(sql`
      SELECT s.id, s.name store, s.marketplace, u.full_name seller,
        coalesce(sum(o.total),0) rev, coalesce(sum(o.platform_fee),0) fee, count(*)::int orders,
        coalesce((SELECT sum(t.amount) FROM transactions t
          WHERE t.store_id = s.id AND t.type <> 'revenue' AND t.occurred_at >= ${FROM} AND t.occurred_at <= ${TO}),0) cost
      FROM orders o JOIN stores s ON s.id = o.store_id LEFT JOIN users u ON u.id = o.seller_id
      WHERE ${ordersWhere}
      GROUP BY 1,2,3,4 ORDER BY rev DESC`),
    db.execute(sql`
      SELECT s.marketplace,
        coalesce(sum(o.total),0) rev, coalesce(sum(o.platform_fee),0) fee,
        coalesce((SELECT sum(t.amount) FROM transactions t JOIN stores s2 ON s2.id = t.store_id
          WHERE s2.marketplace = s.marketplace AND t.type <> 'revenue' AND t.occurred_at >= ${FROM} AND t.occurred_at <= ${TO}${inTxSeller}),0) cost
      FROM orders o JOIN stores s ON s.id = o.store_id
      WHERE ${ordersWhere}
      GROUP BY 1 ORDER BY rev DESC`),
    // THEO NHÀ IN: gộp (đơn, nhà in) trước để KHÔNG đếm trùng doanh thu khi 1 đơn đẩy nhiều dòng
    // cho cùng nhà in. Đơn đẩy sang 2 nhà khác nhau sẽ xuất hiện ở cả 2 hàng (đúng bản chất).
    // Bỏ bản ghi đẩy đã cancelled (không tính chi phí).
    db.execute(sql`
      SELECT f.name,
        count(*)::int orders,
        coalesce(sum(x.cost),0) cost,
        coalesce(sum(x.rev),0) rev,
        coalesce(sum(x.fee),0) fee
      FROM (
        SELECT ffo.fulfiller_id fid, o.id oid,
          sum(coalesce(ffo.cost, coalesce(ffo.base_cost,0) + coalesce(ffo.ship_cost,0) + coalesce(ffo.extra_fee,0))) cost,
          max(o.total) rev, max(o.platform_fee) fee
        FROM fulfillment_orders ffo
        JOIN orders o ON o.id = ffo.order_id
        WHERE ${ordersWhere} AND ffo.status <> 'cancelled'
        GROUP BY 1,2
      ) x
      JOIN fulfillers f ON f.id = x.fid
      GROUP BY f.name ORDER BY cost DESC`),
  ]);

  const trow = (totals.rows[0] ?? {}) as Record<string, unknown>;
  // Bút toán revenue nhập tay (nếu có) cộng thêm vào doanh thu
  const manualRev = (byType.rows as Record<string, unknown>[]).filter((r) => r.type === "revenue").reduce((a, r) => a + Number(r.total ?? 0), 0);
  const revenue = Number(trow.revenue ?? 0) + manualRev;
  const fee = Number(trow.fee ?? 0);
  const cost = (byType.rows as Record<string, unknown>[]).filter((r) => r.type !== "revenue").reduce((a, r) => a + Number(r.total), 0);
  const profit = revenue - fee + cost;

  // Ghép daily rev + cost theo ngày (đủ mọi ngày trong range để chart liền mạch)
  const revMap = new Map((dailyRev.rows as Record<string, unknown>[]).map((r) => [String(r.d).slice(0, 10), r]));
  const costMap = new Map((dailyCost.rows as Record<string, unknown>[]).map((r) => [String(r.d).slice(0, 10), r]));
  const startISO = useRange ? fromQ! : new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const endISO = useRange ? toQ! : new Date().toISOString().slice(0, 10);
  const daily: { d: string; rev: number; cost: number }[] = [];
  for (let t = Date.parse(startISO); t <= Date.parse(endISO); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const r = revMap.get(d), c = costMap.get(d);
    daily.push({ d, rev: Number(r?.rev ?? 0) - Number(r?.fee ?? 0), cost: Number(c?.cost ?? 0) });
  }

  return NextResponse.json({
    ok: true, days, scoped: !!ownerIds,
    totals: { revenue, fee, cost, profit, orders: Number(trow.orders ?? 0) },
    byType: byType.rows, daily, bySeller: bySeller.rows, byStore: byStore.rows, byPlatform: byPlatform.rows,
    bySupplier: bySupplier.rows,
  });
}
