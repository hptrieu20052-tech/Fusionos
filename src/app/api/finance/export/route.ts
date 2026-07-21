import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { scopeOwnerIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/export?days=30 | ?from&to — CSV CHI TIẾT TỪNG ĐƠN (mọi sàn, TẤT CẢ đơn kể cả New/Cancel):
 * Date · Marketplace · Store · Seller · Order ID · Label · Status · Supplier · Tracking
 * · Revenue · Platform Fee · Base/Ship/Other · Fulfillment Cost · Profit + dòng TOTAL cuối file.
 * Cùng phân quyền với trang Finance (seller chỉ thấy đơn mình); cost bóc từ fulfillment_orders (bỏ bản ghi cancelled).
 * Order ID/Tracking bọc ="..." để Excel không đổi số dài thành 4.12E+09.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const lvl = await levelOf(session, "finance");
  if (lvl < 1 && session.role !== "seller") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  let ownerIds: string[] | null = null;
  if (session.role !== "admin") {
    ownerIds = await scopeOwnerIds(session, "orders").catch(() => null);
    if (!ownerIds && session.role === "seller") ownerIds = [session.sub];
  }
  const inSeller = ownerIds ? sql` AND o.seller_id IN (${sql.join(ownerIds.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``;

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") ?? 30), 1), 92);
  const dOk = (x: string | null) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const fromQ = dOk(req.nextUrl.searchParams.get("from"));
  const toQ = dOk(req.nextUrl.searchParams.get("to"));
  const useRange = !!(fromQ && toQ);
  const FROM = useRange ? sql`${fromQ}::date` : sql`CURRENT_DATE - (${days - 1})::int`;
  const TO = useRange ? sql`${toQ}::date` : sql`CURRENT_DATE`;

  // CHI TIẾT TỪNG ĐƠN (không gộp) — mỗi dòng 1 đơn, kèm nhà in + bóc cost base/ship/khác.
  const rows = (await db.execute(sql`
    SELECT o.ordered_at::date AS d, o.platform, coalesce(s.name, '—') AS store, coalesce(u.full_name, '—') AS seller,
      o.external_id, coalesce(o.order_label, '') AS order_label, o.status,
      coalesce(o.total, 0)::numeric AS revenue,
      coalesce(o.platform_fee, 0)::numeric AS fee,
      coalesce(f.base, 0)::numeric AS base_cost,
      coalesce(f.ship, 0)::numeric AS ship_fee,
      coalesce(f.extra, 0)::numeric AS other_fee,
      coalesce(f.total, 0)::numeric AS ff_cost,
      coalesce(f.suppliers, '') AS suppliers,
      coalesce(f.tracking, '') AS tracking
    FROM orders o
    LEFT JOIN stores s ON s.id = o.store_id
    LEFT JOIN users u ON u.id = o.seller_id
    LEFT JOIN LATERAL (
      SELECT sum(fo.base_cost) AS base, sum(fo.ship_cost) AS ship, sum(fo.extra_fee) AS extra, sum(fo.cost) AS total,
             string_agg(DISTINCT ff.name, ' + ') AS suppliers,
             string_agg(DISTINCT fo.tracking_number, ' | ') FILTER (WHERE fo.tracking_number IS NOT NULL) AS tracking
      FROM fulfillment_orders fo JOIN fulfillers ff ON ff.id = fo.fulfiller_id
      WHERE fo.order_id = o.id AND fo.status <> 'cancelled'
    ) f ON true
    WHERE o.ordered_at::date >= ${FROM} AND o.ordered_at::date <= ${TO}${inSeller}
    ORDER BY o.ordered_at DESC
    LIMIT 20000
  `)).rows as { d: string; platform: string; store: string; seller: string; external_id: string; order_label: string; status: string; revenue: string; fee: string; base_cost: string; ship_fee: string; other_fee: string; ff_cost: string; suppliers: string; tracking: string }[];

  const n2 = (v: unknown) => (Math.round(Number(v ?? 0) * 100) / 100).toFixed(2);
  const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const header = ["Date", "Marketplace", "Store", "Seller", "Order ID", "Order Label", "Status", "Supplier", "Tracking", "Revenue", "Platform Fee", "Base Cost", "Ship Fee", "Other Fee", "Fulfillment Cost", "Profit"];
  const lines = [header.join(",")];
  const tot = { revenue: 0, fee: 0, base: 0, ship: 0, extra: 0, cost: 0 };
  for (const r of rows) {
    const revenue = Number(r.revenue), fee = Number(r.fee), cost = Number(r.ff_cost);
    const profit = revenue - fee - cost;
    tot.revenue += revenue; tot.fee += fee;
    tot.base += Number(r.base_cost); tot.ship += Number(r.ship_fee); tot.extra += Number(r.other_fee); tot.cost += cost;
    lines.push([
      String(r.d).slice(0, 10), esc(r.platform), esc(r.store), esc(r.seller),
      `="${r.external_id}"`, esc(r.order_label), r.status, esc(r.suppliers), r.tracking ? `="${r.tracking}"` : "",
      n2(revenue), n2(fee), n2(r.base_cost), n2(r.ship_fee), n2(r.other_fee), n2(cost), n2(profit),
    ].join(","));
  }
  const totProfit = tot.revenue - tot.fee - tot.cost;
  lines.push([
    "TOTAL", "", "", "", `${rows.length} orders`, "", "", "", "",
    n2(tot.revenue), n2(tot.fee), n2(tot.base), n2(tot.ship), n2(tot.extra), n2(tot.cost), n2(totProfit),
  ].join(","));

  const today = new Date().toISOString().slice(0, 10);
  const fname = `fulfillment-cost_${useRange ? `${fromQ}_${toQ}` : `last${days}d`}_${today}.csv`;
  // BOM để Excel mở đúng UTF-8 (tên shop/seller tiếng Việt không vỡ chữ)
  return new NextResponse("﻿" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
