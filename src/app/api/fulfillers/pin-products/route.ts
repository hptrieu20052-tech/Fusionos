import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// POST { fulfillerId, products: string[] }
// Ghim đúng danh sách sản phẩm (theo fulfiller_product) cho form tạo đơn:
// pinned = true cho SKU thuộc products, false cho phần còn lại của nhà này.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  // Chế độ 1: toggle 1 sản phẩm (ghim/bỏ ghim ngay từ bảng, không đụng SP khác)
  if (typeof b.toggleProduct === "string" && b.toggleProduct) {
    const res = await db.update(schema.skuMappings).set({ pinned: !!b.pinned })
      .where(and(eq(schema.skuMappings.fulfillerId, b.fulfillerId), eq(schema.skuMappings.fulfillerProduct, b.toggleProduct)))
      .returning({ id: schema.skuMappings.id });
    return NextResponse.json({ ok: true, pinned: !!b.pinned, count: res.length });
  }

  // Chế độ 2: đặt lại đúng danh sách ghim (dùng ở popup "Chọn SP cho form đơn")
  if (!Array.isArray(b.products)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  const products = (b.products as unknown[]).map(String).filter(Boolean);

  // Reset toàn bộ nhà này về false, rồi bật true cho sản phẩm được chọn
  await db.update(schema.skuMappings).set({ pinned: false }).where(eq(schema.skuMappings.fulfillerId, b.fulfillerId));
  let pinned = 0;
  if (products.length) {
    const res = await db.update(schema.skuMappings).set({ pinned: true })
      .where(and(eq(schema.skuMappings.fulfillerId, b.fulfillerId), inArray(schema.skuMappings.fulfillerProduct, products)))
      .returning({ id: schema.skuMappings.id });
    pinned = res.length;
  }
  return NextResponse.json({ ok: true, pinned, products: products.length });
}
