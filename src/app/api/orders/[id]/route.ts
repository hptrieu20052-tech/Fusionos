import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { inScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

// POST /api/orders/[id]/clone — nhân bản đơn (status new, external_id thêm -CLONE-n)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  // Nhân bản đơn chỉ dành cho admin (staff/seller đã ẩn ở UI)
  if (session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const o = (await db.execute(sql`SELECT * FROM orders WHERE id = ${params.id}::uuid`)).rows[0] as Record<string, unknown> | undefined;
  if (!o) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (!(await inScope(session, "orders", o.seller_id as string | null))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const n = (await db.execute(sql`SELECT count(*)::int c FROM orders WHERE external_id LIKE ${o.external_id + "-CLONE-%"}`)).rows[0] as { c: number };
  const newExt = `${o.external_id}-CLONE-${n.c + 1}`;

  // Order label do người dùng nhập ở hộp xác nhận. Không nhập → dùng label cũ + hậu tố CLONE,
  // vì để trùng y hệt label gốc thì nhìn 2 đơn không phân biệt được.
  const body = await req.json().catch(() => null);
  const custom = typeof body?.orderLabel === "string" ? body.orderLabel.trim().slice(0, 120) : "";
  const label = custom || (o.order_label ? `${o.order_label}-CLONE-${n.c + 1}` : newExt);

  const [clone] = await db.insert(schema.orders).values({
    externalId: newExt,
    platform: o.platform as never, storeId: o.store_id as string | null, sellerId: o.seller_id as string | null,
    status: "new", platformStatus: o.platform_status as string | null, source: "manual",
    buyerFirst: o.buyer_first as string | null, buyerLast: o.buyer_last as string | null,
    addr1: o.addr1 as string | null, addr2: o.addr2 as string | null, city: o.city as string | null,
    state: o.state as string | null, zip: o.zip as string | null, country: (o.country as string) ?? "United States",
    total: String(o.total), platformFee: String(o.platform_fee), currency: (o.currency as string) ?? "USD",
    orderLabel: label, orderedAt: new Date(),
  }).returning();

  await db.execute(sql`
    INSERT INTO order_items (order_id, product_title, internal_sku, qty, unit_price, design_id, special_print, mockup_key,
                             variant, personalization, image_url, product_url, etsy_listing_id)
    SELECT ${clone.id}::uuid, product_title, internal_sku, qty, unit_price, design_id, special_print, mockup_key,
           variant, personalization, image_url, product_url, etsy_listing_id
    FROM order_items WHERE order_id = ${params.id}::uuid
  `);
  return NextResponse.json({ ok: true, order: clone });
}
