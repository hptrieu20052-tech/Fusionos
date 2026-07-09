import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf, hasRestriction } from "@/lib/rbac";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

// GET /api/orders/export?status=&from=&to= — xuất Excel: đơn + base cost + tracking
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const hideProfit = await hasRestriction(session.sub, "hide_profit");
  const own = (await hasRestriction(session.sub, "own_orders_only")) ? sql` AND o.seller_id = ${session.sub}` : sql``;

  const sp = req.nextUrl.searchParams;
  const conds: ReturnType<typeof sql>[] = [];
  const status = sp.get("status");
  if (status) conds.push(sql`o.status = ${status}::order_status`);
  const idsParam = sp.get("ids");
  if (idsParam) {
    const ids = idsParam.split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 500);
    if (ids.length) conds.push(sql`o.id IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})`);
  }
  if (sp.get("from")) conds.push(sql`o.ordered_at::date >= ${sp.get("from")}::date`);
  if (sp.get("to")) conds.push(sql`o.ordered_at::date <= ${sp.get("to")}::date`);
  // Chỉ đơn ĐỦ ĐIỀU KIỆN (để import lên nhà in không API): có item, mọi item có design + mockup, đủ địa chỉ
  if (sp.get("complete") === "1") {
    conds.push(sql`EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)`);
    conds.push(sql`NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND (oi.design_id IS NULL OR oi.mockup_key IS NULL OR oi.mockup_key = ''))`);
    conds.push(sql`coalesce(o.addr1,'') <> '' AND coalesce(o.city,'') <> '' AND coalesce(o.zip,'') <> '' AND coalesce(o.country,'') <> ''`);
  }
  const where = conds.length ? conds.reduce((a, c) => sql`${a} AND ${c}`) : sql`TRUE`;

  const rows = (await db.execute(sql`
    SELECT o.external_id, o.order_label, o.platform, s.name AS store, u.full_name AS seller,
      o.status, o.ordered_at::date AS ordered_date,
      coalesce(o.buyer_first,'') || ' ' || coalesce(o.buyer_last,'') AS buyer,
      o.addr1, o.addr2, o.city, o.state, o.zip, o.country,
      o.total, o.platform_fee,
      coalesce((SELECT -sum(amount) FROM transactions t WHERE t.order_id = o.id AND t.type='base_cost'),0) AS base_cost,
      fo.tracking_number, fo.tracking_carrier, f.name AS fulfiller, fo.external_ff_id
    FROM orders o
    LEFT JOIN users u ON u.id = o.seller_id
    LEFT JOIN stores s ON s.id = o.store_id
    LEFT JOIN LATERAL (SELECT * FROM fulfillment_orders WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) fo ON TRUE
    LEFT JOIN fulfillers f ON f.id = fo.fulfiller_id
    WHERE ${where}${own}
    ORDER BY o.ordered_at DESC LIMIT 5000
  `)).rows as Record<string, unknown>[];

  const data = rows.map((r) => ({
    "Order ID": r.external_id, "Order Label": r.order_label ?? "",
    "Platform": r.platform, "Store": r.store ?? "", "Seller": r.seller ?? "",
    "Status": r.status, "Ngày đặt": String(r.ordered_date ?? "").slice(0, 10),
    "Khách": r.buyer, "Addr1": r.addr1 ?? "", "Addr2": r.addr2 ?? "",
    "City": r.city ?? "", "State": r.state ?? "", "ZIP": r.zip ?? "", "Country": r.country,
    "Total": Number(r.total), "Fee": Number(r.platform_fee),
    ...(hideProfit ? {} : { "Base Cost": Number(r.base_cost) }),
    "Fulfiller": r.fulfiller ?? "", "FF Order ID": r.external_ff_id ?? "",
    "Tracking Number": r.tracking_number ?? "", "Carrier": r.tracking_carrier ?? "",
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = Object.keys(data[0] ?? { a: 1 }).map((k) => ({ wch: Math.max(k.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Orders");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="fusion-orders-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
