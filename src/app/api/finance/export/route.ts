import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { scopeOwnerIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/export?days=30 | ?from&to — CSV thống kê FULFILLMENT COST theo SHOP (mọi sàn):
 * Marketplace · Store · Seller · Orders (TẤT CẢ đơn, gồm cả New + Cancel — có cột đếm Cancelled riêng)
 * · Revenue · Platform Fee · Base Cost · Ship Fee · Other Fee · Fulfillment Cost · Profit · Margin %.
 * Cùng phân quyền với trang Finance (seller chỉ thấy shop mình); cost bóc từ fulfillment_orders (bỏ bản ghi cancelled).
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

  const rows = (await db.execute(sql`
    SELECT o.platform, coalesce(s.name, '—') AS store, coalesce(u.full_name, '—') AS seller,
      count(*)::int AS orders,
      count(*) FILTER (WHERE o.status IN ('cancel', 'trash'))::int AS cancelled,
      coalesce(sum(o.total), 0)::numeric AS revenue,
      coalesce(sum(o.platform_fee), 0)::numeric AS fee,
      coalesce(sum(f.base), 0)::numeric AS base_cost,
      coalesce(sum(f.ship), 0)::numeric AS ship_fee,
      coalesce(sum(f.extra), 0)::numeric AS other_fee,
      coalesce(sum(f.total), 0)::numeric AS ff_cost
    FROM orders o
    LEFT JOIN stores s ON s.id = o.store_id
    LEFT JOIN users u ON u.id = o.seller_id
    LEFT JOIN LATERAL (
      SELECT sum(fo.base_cost) AS base, sum(fo.ship_cost) AS ship, sum(fo.extra_fee) AS extra, sum(fo.cost) AS total
      FROM fulfillment_orders fo WHERE fo.order_id = o.id AND fo.status <> 'cancelled'
    ) f ON true
    WHERE o.ordered_at::date >= ${FROM} AND o.ordered_at::date <= ${TO}${inSeller}
    GROUP BY o.platform, s.name, u.full_name
    ORDER BY revenue DESC
  `)).rows as { platform: string; store: string; seller: string; orders: number; cancelled: number; revenue: string; fee: string; base_cost: string; ship_fee: string; other_fee: string; ff_cost: string }[];

  const n2 = (v: unknown) => (Math.round(Number(v ?? 0) * 100) / 100).toFixed(2);
  const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const header = ["Marketplace", "Store", "Seller", "Orders", "Cancelled", "Revenue", "Platform Fee", "Base Cost", "Ship Fee", "Other Fee", "Fulfillment Cost", "Profit", "Margin %"];
  const lines = [header.join(",")];
  const tot = { orders: 0, cancelled: 0, revenue: 0, fee: 0, base: 0, ship: 0, extra: 0, cost: 0 };
  for (const r of rows) {
    const revenue = Number(r.revenue), fee = Number(r.fee), cost = Number(r.ff_cost);
    const profit = revenue - fee - cost;
    tot.orders += Number(r.orders); tot.cancelled += Number(r.cancelled); tot.revenue += revenue; tot.fee += fee;
    tot.base += Number(r.base_cost); tot.ship += Number(r.ship_fee); tot.extra += Number(r.other_fee); tot.cost += cost;
    lines.push([
      esc(r.platform), esc(r.store), esc(r.seller), String(r.orders), String(r.cancelled),
      n2(revenue), n2(fee), n2(r.base_cost), n2(r.ship_fee), n2(r.other_fee), n2(cost),
      n2(profit), revenue > 0 ? (profit / revenue * 100).toFixed(1) : "0.0",
    ].join(","));
  }
  const totProfit = tot.revenue - tot.fee - tot.cost;
  lines.push([
    "TOTAL", "", "", String(tot.orders), String(tot.cancelled), n2(tot.revenue), n2(tot.fee), n2(tot.base), n2(tot.ship), n2(tot.extra), n2(tot.cost),
    n2(totProfit), tot.revenue > 0 ? (totProfit / tot.revenue * 100).toFixed(1) : "0.0",
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
