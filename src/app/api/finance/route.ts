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
  const inSeller = ownerIds ? sql` AND o.seller_at_order IN (${sql.join(ownerIds.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``;
  const inTxSeller = ownerIds ? sql` AND t.seller_id IN (${sql.join(ownerIds.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``;
  // v166 — ĐƠN HUỶ THÌ MỌI CON SỐ = 0.
  // Bug cũ: doanh thu tính từ orders (đã loại cancel/trash) nhưng COST tính từ transactions KHÔNG hề
  // loại đơn huỷ → chi phí của đơn không tồn tại vẫn ăn vào lợi nhuận. Lọc ngay tại nguồn.
  const txLive = sql` AND (t.order_id IS NULL OR NOT EXISTS (SELECT 1 FROM orders oc WHERE oc.id = t.order_id AND oc.status IN ('cancel','trash')))`;

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") ?? 30), 1), 92);
  const dOk = (x: string | null) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const fromQ = dOk(req.nextUrl.searchParams.get("from"));
  const toQ = dOk(req.nextUrl.searchParams.get("to"));
  const useRange = !!(fromQ && toQ);
  const FROM = useRange ? sql`${fromQ}::date` : sql`CURRENT_DATE - (${days - 1})::int`;
  const TO = useRange ? sql`${toQ}::date` : sql`CURRENT_DATE`;

  // Đơn tính doanh thu: trong range, không cancel/trash
  const ordersWhere = sql`o.ordered_at::date >= ${FROM} AND o.ordered_at::date <= ${TO} AND o.status NOT IN ('cancel','trash')${inSeller}`;
  // v632 · range dạng chuỗi (meta_insights.day là text YYYY-MM-DD) — cũng dùng cho mảng daily bên dưới
  const startISO = useRange ? fromQ! : new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const endISO = useRange ? toQ! : new Date().toISOString().slice(0, 10);

  const [totals, byType, dailyRev, dailyCost, bySeller, byStore, byPlatform, bySupplier] = await Promise.all([
    // Tổng revenue + fee từ orders
    db.execute(sql`
      SELECT coalesce(sum(o.total),0) revenue, coalesce(sum(o.platform_fee),0) fee,
        -- Phần phí đang là ƯỚC TÍNH (%) — UI ghi rõ "Fee (est.)" để không nhầm là số quyết toán thật
        coalesce(sum(o.platform_fee) FILTER (WHERE o.fee_estimated),0) fee_est,
        count(*) FILTER (WHERE o.fee_estimated)::int orders_est,
        count(*)::int orders
      FROM orders o WHERE ${ordersWhere}`),
    // Cost theo type (transactions âm; bút toán 'revenue' nhập tay vẫn cộng vào doanh thu qua totals riêng)
    db.execute(sql`
      SELECT type, sum(amount) total FROM transactions t
      WHERE t.occurred_at >= ${FROM} AND t.occurred_at <= ${TO}${inTxSeller}${txLive}
      GROUP BY 1 ORDER BY total`),
    db.execute(sql`
      SELECT o.ordered_at::date d, sum(o.total) rev, sum(o.platform_fee) fee
      FROM orders o WHERE ${ordersWhere} GROUP BY 1`),
    db.execute(sql`
      SELECT t.occurred_at d, sum(t.amount) FILTER (WHERE t.type <> 'revenue') cost
      FROM transactions t WHERE t.occurred_at >= ${FROM} AND t.occurred_at <= ${TO}${inTxSeller}${txLive} GROUP BY 1`),
    // Theo SELLER: rev/fee từ orders + cost từ transactions
    // CỘT COST = CHI PHÍ FULFILL THUẦN: loại 'revenue' và loại luôn 'platform_fee'
    // (bút toán phí sàn nhập tay được cộng sang cột FEE, tuyệt đối KHÔNG nằm trong Cost → không đếm 2 lần).
    // v632 · cost LOẠI type 'ads' (ads có cột riêng, không nằm trong Fulfillment cost nữa);
    // ads_manual = bút toán ads nhập tay theo seller (ÂM) — cộng với ads Meta tự động ở JS.
    db.execute(sql`
      SELECT u.id, u.full_name name,
        coalesce(sum(o.total),0) rev,
        coalesce(sum(o.platform_fee),0) - coalesce((SELECT sum(t.amount) FROM transactions t
          WHERE t.seller_id = u.id AND t.type = 'platform_fee' AND t.occurred_at >= ${FROM} AND t.occurred_at <= ${TO}${txLive}),0) fee,
        coalesce((SELECT sum(t.amount) FROM transactions t
          WHERE t.seller_id = u.id AND t.type NOT IN ('revenue','platform_fee','ads') AND t.occurred_at >= ${FROM} AND t.occurred_at <= ${TO}${txLive}),0) cost,
        coalesce((SELECT sum(t.amount) FROM transactions t
          WHERE t.seller_id = u.id AND t.type = 'ads' AND t.occurred_at >= ${FROM} AND t.occurred_at <= ${TO}${txLive}),0) ads_manual
      FROM orders o JOIN users u ON u.id = o.seller_at_order
      WHERE ${ordersWhere}
      GROUP BY 1,2 ORDER BY rev DESC`),
    // THEO STORE (chi tiết store của seller): store + marketplace + seller
    // v400 FIX: cost/fee phải lọc theo CẢ seller — trước đây chỉ lọc store_id nên store nhiều seller
    // (vd Talewix Shopify) bị dán NGUYÊN tổng cost của store vào từng dòng seller → trùng N lần.
    // IS NOT DISTINCT FROM để dòng "seller trống" (đơn không gắn seller) vẫn khớp transaction seller NULL.
    db.execute(sql`
      SELECT s.id, s.name store, s.marketplace, u.full_name seller,
        coalesce(sum(o.total),0) rev, count(*)::int orders,
        coalesce(sum(o.platform_fee),0) - coalesce((SELECT sum(t.amount) FROM transactions t
          WHERE t.store_id = s.id AND t.seller_id IS NOT DISTINCT FROM u.id AND t.type = 'platform_fee' AND t.occurred_at >= ${FROM} AND t.occurred_at <= ${TO}${txLive}),0) fee,
        coalesce((SELECT sum(t.amount) FROM transactions t
          WHERE t.store_id = s.id AND t.seller_id IS NOT DISTINCT FROM u.id AND t.type NOT IN ('revenue','platform_fee','ads') AND t.occurred_at >= ${FROM} AND t.occurred_at <= ${TO}${txLive}),0) cost
      FROM orders o JOIN stores s ON s.id = o.store_id LEFT JOIN users u ON u.id = o.seller_at_order
      WHERE ${ordersWhere}
      GROUP BY s.id, s.name, s.marketplace, u.id, u.full_name ORDER BY rev DESC`),
    db.execute(sql`
      SELECT s.marketplace,
        coalesce(sum(o.total),0) rev,
        coalesce(sum(o.platform_fee),0) - coalesce((SELECT sum(t.amount) FROM transactions t JOIN stores s2 ON s2.id = t.store_id
          WHERE s2.marketplace = s.marketplace AND t.type = 'platform_fee' AND t.occurred_at >= ${FROM} AND t.occurred_at <= ${TO}${inTxSeller}${txLive}),0) fee,
        coalesce((SELECT sum(t.amount) FROM transactions t JOIN stores s2 ON s2.id = t.store_id
          WHERE s2.marketplace = s.marketplace AND t.type NOT IN ('revenue','platform_fee','ads') AND t.occurred_at >= ${FROM} AND t.occurred_at <= ${TO}${inTxSeller}${txLive}),0) cost
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

  // ═══ v632 · CHI PHÍ ADS (Meta) — spend thật từ meta_insights, gán seller qua meta_ad_sellers
  // (bảng do /api/meta-ads/entities tự ghi + admin gán tay cho ads cũ). Seller xem Finance chỉ
  // thấy ads CỦA MÌNH (lọc seller_id theo scope). Bảng chưa migrate → ads = 0, Finance chạy như cũ.
  let adsAuto = 0;
  const adsDailyMap = new Map<string, number>();
  let adsBySellerRows: { sid: string | null; name: string; spend: number }[] = [];
  try {
    const adsWhere = ownerIds
      ? sql`FROM meta_insights mi JOIN meta_ad_sellers mas ON mas.ad_id = mi.ad_id WHERE mi.day >= ${startISO} AND mi.day <= ${endISO} AND mas.seller_id IN (${sql.join(ownerIds.map((x) => sql`${x}::uuid`), sql`, `)})`
      : sql`FROM meta_insights mi LEFT JOIN meta_ad_sellers mas ON mas.ad_id = mi.ad_id WHERE mi.day >= ${startISO} AND mi.day <= ${endISO}`;
    const [aTot, aDly, aSel] = await Promise.all([
      db.execute(sql`SELECT coalesce(sum(mi.spend),0) s ${adsWhere}`),
      db.execute(sql`SELECT mi.day d, sum(mi.spend) s ${adsWhere} GROUP BY 1`),
      db.execute(sql`SELECT mas.seller_id sid, coalesce(mas.seller_name,'') name, sum(mi.spend) s ${adsWhere} GROUP BY 1,2 ORDER BY 3 DESC`),
    ]);
    adsAuto = Number((aTot.rows[0] as Record<string, unknown>)?.s ?? 0);
    for (const r of aDly.rows as Record<string, unknown>[]) adsDailyMap.set(String(r.d).slice(0, 10), Number(r.s ?? 0));
    adsBySellerRows = (aSel.rows as Record<string, unknown>[]).map((r) => ({ sid: r.sid ? String(r.sid) : null, name: String(r.name ?? ""), spend: Number(r.s ?? 0) }));
  } catch { /* meta_ad_sellers chưa migrate / meta_insights trống → ads = 0 */ }

  const trow = (totals.rows[0] ?? {}) as Record<string, unknown>;
  // Bút toán revenue nhập tay (nếu có) cộng thêm vào doanh thu
  const manualRev = (byType.rows as Record<string, unknown>[]).filter((r) => r.type === "revenue").reduce((a, r) => a + Number(r.total ?? 0), 0);
  const revenue = Number(trow.revenue ?? 0) + manualRev;
  // Bút toán 'platform_fee' nhập tay (lưu ÂM) → cộng vào FEE, KHÔNG nằm trong Fulfillment cost.
  const manualFee = (byType.rows as Record<string, unknown>[]).filter((r) => r.type === "platform_fee").reduce((a, r) => a + Math.abs(Number(r.total ?? 0)), 0);
  const fee = Number(trow.fee ?? 0) + manualFee;
  // COST = CHI PHÍ FULFILL THUẦN (base_cost/shipping/sample/salary/tool/refund/other) — KHÔNG có phí sàn.
  // v632 · cũng KHÔNG còn 'ads': chi phí ads (Meta tự động + nhập tay) có thẻ/cột riêng.
  const cost = (byType.rows as Record<string, unknown>[]).filter((r) => r.type !== "revenue" && r.type !== "platform_fee" && r.type !== "ads").reduce((a, r) => a + Number(r.total), 0);
  const adsManualSigned = (byType.rows as Record<string, unknown>[]).filter((r) => r.type === "ads").reduce((a, r) => a + Number(r.total ?? 0), 0); // ÂM
  const adsSpend = adsAuto + Math.abs(adsManualSigned);
  const profit = revenue - fee + cost + adsManualSigned - adsAuto;

  // Ghép daily rev + cost + ads theo ngày (đủ mọi ngày trong range để chart liền mạch)
  const revMap = new Map((dailyRev.rows as Record<string, unknown>[]).map((r) => [String(r.d).slice(0, 10), r]));
  const costMap = new Map((dailyCost.rows as Record<string, unknown>[]).map((r) => [String(r.d).slice(0, 10), r]));
  const daily: { d: string; rev: number; cost: number; ads: number }[] = [];
  for (let t = Date.parse(startISO); t <= Date.parse(endISO); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const r = revMap.get(d), c = costMap.get(d);
    daily.push({ d, rev: Number(r?.rev ?? 0) - Number(r?.fee ?? 0), cost: Number(c?.cost ?? 0), ads: adsDailyMap.get(d) ?? 0 });
  }

  // v632 · gắn chi phí ads vào từng dòng seller (auto theo seller_id + bút toán tay); seller chỉ
  // chạy ads mà chưa có đơn trong kỳ vẫn phải hiện dòng (kế toán tháng cần đủ chi phí).
  const adsAutoBySid = new Map(adsBySellerRows.filter((r) => r.sid).map((r) => [r.sid as string, r.spend]));
  const sellerRows = (bySeller.rows as Record<string, unknown>[]).map((s) => ({
    ...s,
    ads: (adsAutoBySid.get(String(s.id)) ?? 0) + Math.abs(Number(s.ads_manual ?? 0)),
  }));
  const seenSid = new Set(sellerRows.map((s) => String((s as Record<string, unknown>).id)));
  for (const r of adsBySellerRows) {
    if (r.sid && !seenSid.has(r.sid) && r.spend > 0) sellerRows.push({ id: r.sid, name: r.name || "—", rev: 0, fee: 0, cost: 0, ads: r.spend });
  }
  const adsUnassigned = adsBySellerRows.filter((r) => !r.sid).reduce((a, r) => a + r.spend, 0);

  return NextResponse.json({
    ok: true, days, scoped: !!ownerIds,
    totals: {
      revenue, fee, cost, profit, orders: Number(trow.orders ?? 0), feeEst: Number(trow.fee_est ?? 0), ordersEst: Number(trow.orders_est ?? 0),
      // v632 · ads: tổng chi phí ads trong kỳ (Meta tự động + nhập tay) — đã TRỪ vào profit.
      ads: adsSpend, adsAuto, adsManual: Math.abs(adsManualSigned), adsUnassigned,
    },
    byType: byType.rows, daily, bySeller: sellerRows, byStore: byStore.rows, byPlatform: byPlatform.rows,
    bySupplier: bySupplier.rows,
  });
}
