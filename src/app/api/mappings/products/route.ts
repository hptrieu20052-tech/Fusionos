import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, isNotNull, sql, asc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// GET /api/mappings/products?ff=<id>&q=<search>
// Danh sách sản phẩm (gom theo fulfiller_product) cho popup ghim.
// q khớp TÊN sản phẩm HOẶC SKU (product SKU/variant SKU/variant) — tìm cả theo mã.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const ff = req.nextUrl.searchParams.get("ff");
  if (!ff) return NextResponse.json({ ok: false, error: "missing ff" }, { status: 400 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

  let qb = db.select({
    product: schema.skuMappings.fulfillerProduct,
    count: sql<number>`count(*)::int`,
    pinned: sql<boolean>`bool_or(${schema.skuMappings.pinned})`,
  }).from(schema.skuMappings)
    .where(and(eq(schema.skuMappings.fulfillerId, ff), isNotNull(schema.skuMappings.fulfillerProduct)))
    .groupBy(schema.skuMappings.fulfillerProduct)
    .$dynamic();

  if (q) {
    const like = `%${q}%`;
    // Giữ product nếu TÊN hoặc BẤT KỲ SKU/variant nào của nó khớp
    qb = qb.having(sql`bool_or(
      ${schema.skuMappings.fulfillerProduct} ILIKE ${like}
      OR ${schema.skuMappings.internalSku} ILIKE ${like}
      OR ${schema.skuMappings.fulfillerSku} ILIKE ${like}
      OR coalesce(${schema.skuMappings.variant}, '') ILIKE ${like}
    )`);
  }

  const rows = await qb.orderBy(asc(schema.skuMappings.fulfillerProduct)).limit(500);
  return NextResponse.json({ ok: true, products: rows.map((r) => ({ product: r.product as string, count: r.count, pinned: !!r.pinned })) });
}
