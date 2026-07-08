import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, isNotNull, sql, asc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// GET /api/mappings/products?ff=<id> — danh sách sản phẩm (gom theo fulfiller_product) cho popup ghim.
// Trả số SKU + đã ghim hay chưa. Nhẹ hơn nhiều so với kéo toàn bộ variant.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const ff = req.nextUrl.searchParams.get("ff");
  if (!ff) return NextResponse.json({ ok: false, error: "missing ff" }, { status: 400 });

  const rows = await db.select({
    product: schema.skuMappings.fulfillerProduct,
    count: sql<number>`count(*)::int`,
    pinned: sql<boolean>`bool_or(${schema.skuMappings.pinned})`,
  }).from(schema.skuMappings)
    .where(and(eq(schema.skuMappings.fulfillerId, ff), isNotNull(schema.skuMappings.fulfillerProduct)))
    .groupBy(schema.skuMappings.fulfillerProduct)
    .orderBy(asc(schema.skuMappings.fulfillerProduct));

  return NextResponse.json({ ok: true, products: rows.map((r) => ({ product: r.product as string, count: r.count, pinned: !!r.pinned })) });
}
