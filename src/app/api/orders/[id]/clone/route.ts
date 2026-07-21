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
  // Nhân bản đơn: admin + support (seller vẫn ẩn ở UI)
  if (session.role !== "admin" && session.role !== "support") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

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

  // ===== SPLIT MODE (1 đơn → 2 supplier): body.itemIds = các item CHUYỂN sang đơn mới =====
  // · Đơn MỚI: item chuyển đi giữ qty, item ở lại → qty 0 (giữ dòng để đối chiếu, không fulfill)
  // · Đơn GỐC: item chuyển đi → qty 0
  // · total + platform_fee CHIA THEO TỶ TRỌNG GIÁ TRỊ item → tổng 2 đơn = đúng 1 lần doanh thu, sổ không phồng đôi.
  const items = (await db.execute(sql`SELECT id, qty, unit_price FROM order_items WHERE order_id = ${params.id}::uuid`)).rows as { id: string; qty: number; unit_price: string }[];
  const moveIds = new Set(Array.isArray(body?.itemIds) ? (body.itemIds as string[]).filter((x) => items.some((i) => i.id === x)) : []);
  const isSplit = moveIds.size > 0 && moveIds.size < items.length;

  let cloneTotal = String(o.total), cloneFee = String(o.platform_fee);
  if (isSplit) {
    const val = (list: { qty: number; unit_price: string }[]) => list.reduce((a, i) => a + Number(i.unit_price) * Math.max(i.qty, 0), 0);
    const all = val(items);
    const share = all > 0 ? val(items.filter((i) => moveIds.has(i.id))) / all : moveIds.size / items.length;
    cloneTotal = (Number(o.total) * share).toFixed(2);
    cloneFee = (Number(o.platform_fee) * share).toFixed(2);
  }

  const [clone] = await db.insert(schema.orders).values({
    externalId: newExt,
    platform: o.platform as never, storeId: o.store_id as string | null, sellerId: o.seller_id as string | null,
    status: "new", platformStatus: o.platform_status as string | null, source: "manual",
    buyerFirst: o.buyer_first as string | null, buyerLast: o.buyer_last as string | null,
    addr1: o.addr1 as string | null, addr2: o.addr2 as string | null, city: o.city as string | null,
    state: o.state as string | null, zip: o.zip as string | null, country: (o.country as string) ?? "United States",
    total: cloneTotal, platformFee: cloneFee, currency: (o.currency as string) ?? "USD",
    orderLabel: label, orderedAt: new Date(),
  }).returning();

  // Copy item — split: item Ở LẠI đơn gốc mang qty 0 trên đơn mới
  const stayIds = items.filter((i) => !moveIds.has(i.id)).map((i) => i.id);
  const zeroExpr = isSplit && stayIds.length
    ? sql`CASE WHEN id IN (${sql.join(stayIds.map((x) => sql`${x}::uuid`), sql`, `)}) THEN 0 ELSE qty END`
    : sql`qty`;
  await db.execute(sql`
    INSERT INTO order_items (order_id, product_title, internal_sku, qty, unit_price, design_id, special_print, mockup_key,
                             variant, personalization, image_url, product_url, etsy_listing_id)
    SELECT ${clone.id}::uuid, product_title, internal_sku, ${zeroExpr}, unit_price, design_id, special_print, mockup_key,
           variant, personalization, image_url, product_url, etsy_listing_id
    FROM order_items WHERE order_id = ${params.id}::uuid
  `);

  if (isSplit) {
    // Đơn GỐC: item đã chuyển → qty 0; total/fee = phần còn lại (bù chính xác, không lệch xu vì làm tròn)
    await db.execute(sql`
      UPDATE order_items SET qty = 0
      WHERE order_id = ${params.id}::uuid AND id IN (${sql.join(Array.from(moveIds).map((x) => sql`${x}::uuid`), sql`, `)})
    `);
    const remTotal = (Number(o.total) - Number(cloneTotal)).toFixed(2);
    const remFee = (Number(o.platform_fee) - Number(cloneFee)).toFixed(2);
    await db.execute(sql`UPDATE orders SET total = ${remTotal}, platform_fee = ${remFee}, updated_at = NOW() WHERE id = ${params.id}::uuid`);
  }
  return NextResponse.json({ ok: true, order: clone, split: isSplit });
}
