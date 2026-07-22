import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { inScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * POST /api/order-items/[id]/duplicate — NHÂN BẢN 1 item NGAY TRONG đơn đó (không phải dup cả đơn).
 * Ca dùng: khách đặt qty=3 nhưng gói 3 personalization khác nhau vào 1 dòng → support bấm dup ra thành
 * nhiều dòng, mỗi dòng gán design/tên riêng. CHỈ role admin/support (khách/seller không thấy nút).
 * Bản sao: giữ nguyên sản phẩm/variant/personalization/ảnh, qty=1, BỎ gán design & mockup (support gán mới).
 * Trung lập tài chính: doanh thu tính theo orders.total (cấp đơn) nên nhân item KHÔNG làm phồng tiền.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  // Chỉ support/admin — đúng yêu cầu "role support thôi".
  if (session.role !== "admin" && session.role !== "support") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if ((await levelOf(session, "orders")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const src = (await db.execute(sql`
    SELECT i.*, o.seller_id AS o_seller FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = ${params.id}::uuid
  `)).rows[0] as Record<string, unknown> | undefined;
  if (!src) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (!(await inScope(session, "orders", (src.o_seller as string | null) ?? null))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const b = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(b?.count ?? 1), 1), 20); // dup 1–20 bản/lần

  const newIds: string[] = [];
  for (let k = 0; k < count; k++) {
    const [row] = await db.insert(schema.orderItems).values({
      orderId: src.order_id as string,
      productTitle: (src.product_title as string) ?? "Item",
      internalSku: (src.internal_sku as string | null) ?? null,
      qty: 1,
      unitPrice: String(src.unit_price ?? "0"),
      // KHÔNG copy designId/mockupKey — bản mới cần gán design riêng
      specialPrint: false,
      personalization: (src.personalization as string | null) ?? null,
      variant: (src.variant as string | null) ?? null,
      imageUrl: (src.image_url as string | null) ?? null,
      productUrl: (src.product_url as string | null) ?? null,
      etsyListingId: (src.etsy_listing_id as string | null) ?? null,
      buyerFiles: (src.buyer_files as unknown) ?? null,
    }).returning({ id: schema.orderItems.id });
    if (row?.id) newIds.push(row.id);
  }

  return NextResponse.json({ ok: true, newIds, count: newIds.length });
}
