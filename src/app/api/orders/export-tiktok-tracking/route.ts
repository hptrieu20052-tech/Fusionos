import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { hasAction } from "@/lib/actions";
import { scopeOwnerIds } from "@/lib/scope";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

// Tên carrier TikTok chấp nhận (theo template chính thức) — map từ tên carrier nhà in trả về
const CARRIER_MAP: [RegExp, string][] = [
  [/usps/i, "USPS"],
  [/ups/i, "UPS"],
  [/fedex/i, "FedEx"],
  [/dhl.*e|ecom/i, "DHL eCommerce"],
  [/dhl.*exp/i, "DHL express"],
  [/dhl/i, "DHL eCommerce"],
  [/ontrac/i, "OnTrac"],
  [/osm/i, "OSM Worldwide"],
  [/lasership/i, "LaserShip"],
  [/gls/i, "GLS US"],
  [/asendia/i, "Asendia US"],
  [/uniuni/i, "UniUni"],
  [/veho/i, "Veho"],
  [/speedx/i, "Speedx"],
  [/amazon/i, "Amazon shipping + Amazon MCF"],
  [/cainiao/i, "Cainiao US"],
  [/yanwen/i, "Yanwen"],
];
function mapCarrier(raw: string): string {
  for (const [re, name] of CARRIER_MAP) if (re.test(raw)) return name;
  return raw; // không map được → giữ nguyên cho seller tự chỉnh
}

/**
 * GET /api/orders/export-tiktok-tracking?from=&to=
 * Xuất file "Shipment info" đúng khuôn template bulk-upload của TikTok Seller Center:
 * row1 ghi chú, row2 header (Order ID / Tracking ID / Shipping Provider Name / Auto Combine Group ID),
 * data từ row3, cột D = "N/A". Chỉ đơn TikTok ĐÃ CÓ tracking.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!(await hasAction(session, "orders.export"))) return NextResponse.json({ ok: false, error: "forbidden: export" }, { status: 403 });
  const _si = await scopeOwnerIds(session, "orders");
  const own = _si ? sql` AND o.seller_id IN (${sql.join(_si.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``;

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const dateCond = sql`${from ? sql` AND o.ordered_at::date >= ${from}::date` : sql``}${to ? sql` AND o.ordered_at::date <= ${to}::date` : sql``}`;

  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (o.id) o.external_id, fo.tracking_number, coalesce(fo.tracking_carrier,'') AS carrier
    FROM orders o
    JOIN fulfillment_orders fo ON fo.order_id = o.id AND coalesce(fo.tracking_number,'') <> ''
    WHERE o.platform = 'tiktok' AND coalesce(o.external_id,'') <> ''${own}${dateCond}
    ORDER BY o.id, fo.created_at DESC
  `)) as unknown as { external_id: string; tracking_number: string; carrier: string }[];

  const aoa: (string | null)[][] = [
    ["Please fill in tracking info. Do not change the header row. Shipping Provider Name must match TikTok's supported carrier list."],
    ["Order ID", "Tracking ID", "Shipping Provider Name", "Auto Combine Group ID"],
    ...rows.map((r) => [String(r.external_id), String(r.tracking_number), mapCarrier(String(r.carrier)), "N/A"]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 22 }, { wch: 26 }, { wch: 28 }, { wch: 22 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Shipment info");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tiktok_shipment_info_${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
