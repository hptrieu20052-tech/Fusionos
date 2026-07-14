import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { hasAction } from "@/lib/actions";
import { scopeOwnerIds } from "@/lib/scope";
import { mapTiktokCarrier } from "@/lib/tiktok-carriers";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

/**
 * GET /api/orders/export-tiktok-tracking?storeId=&from=&to=
 *
 * Xuất file "Shipment info" ĐÚNG khuôn template bulk-upload của TikTok Seller Center:
 *   Sheet "Shipping info"
 *   Dòng 1: "Review the examples before you fill out this sheet."
 *   Dòng 2: Order ID | Tracking ID | Shipping Provider Name   ← ĐÚNG 3 CỘT
 *   Dòng 3+: dữ liệu
 *
 * storeId BẮT BUỘC: file upload lên TỪNG shop. Trộn đơn nhiều shop vào một file
 * thì TikTok từ chối, hoặc tệ hơn là gán tracking sang shop khác.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!(await hasAction(session, "orders.export"))) return NextResponse.json({ ok: false, error: "forbidden: export" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const storeId = sp.get("storeId") ?? "";
  if (!storeId) return NextResponse.json({ ok: false, error: "Pick a TikTok store first" }, { status: 400 });

  const [store] = (await db.execute(sql`
    SELECT id, name, marketplace FROM stores WHERE id = ${storeId}::uuid LIMIT 1
  `)).rows as { id: string; name: string; marketplace: string }[];
  if (!store) return NextResponse.json({ ok: false, error: "Store not found" }, { status: 404 });
  if (store.marketplace !== "tiktok") return NextResponse.json({ ok: false, error: "That store is not a TikTok store" }, { status: 400 });

  const _si = await scopeOwnerIds(session, "orders");
  const own = _si ? sql` AND o.seller_id IN (${sql.join(_si.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``;

  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const dateCond = sql`${from ? sql` AND o.ordered_at::date >= ${from}::date` : sql``}${to ? sql` AND o.ordered_at::date <= ${to}::date` : sql``}`;

  // .rows — db.execute() với node-postgres trả QueryResult, KHÔNG phải mảng
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (o.id) o.external_id, fo.tracking_number, coalesce(fo.tracking_carrier,'') AS carrier
    FROM orders o
    JOIN fulfillment_orders fo ON fo.order_id = o.id AND coalesce(fo.tracking_number,'') <> ''
    WHERE o.platform = 'tiktok'
      AND o.store_id = ${storeId}::uuid
      AND coalesce(o.external_id,'') <> ''${own}${dateCond}
    ORDER BY o.id, fo.created_at DESC
  `)).rows as { external_id: string; tracking_number: string; carrier: string }[];

  const aoa: string[][] = [
    ["Review the examples before you fill out this sheet."],
    ["Order ID", "Tracking ID", "Shipping Provider Name"],
    ...rows.map((r) => [String(r.external_id), String(r.tracking_number), mapTiktokCarrier(String(r.carrier))]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 24 }, { wch: 28 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Shipping info");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const safe = store.name.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="shipment_info_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "X-Row-Count": String(rows.length),
    },
  });
}
