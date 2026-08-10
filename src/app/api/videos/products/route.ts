import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, desc, eq, ilike, inArray, isNotNull, ne } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * v207 · GET /api/videos/products?q=<text> → danh sách listing GỌN để chọn khi gắn video.
 *
 * KHÔNG dùng /api/shopify-products cho việc này: route đó kéo cả variants/images/collections của
 * TOÀN BỘ sản phẩm về chỉ để hiện một ô chọn — nặng vô ích. Ở đây chỉ lấy 5 cột.
 * Bỏ qua bản nháp chưa lên Shopify (shopify_product_id rỗng) vì video không gắn vào đó được.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const allowed = (await levelOf(session, "products")) >= 1 || (await levelOf(session, "designs")) >= 1;
  if (!allowed) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const q = String(req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  const conds = [isNotNull(schema.shopifyProducts.shopifyProductId), ne(schema.shopifyProducts.shopifyProductId, "")];
  if (q) conds.push(ilike(schema.shopifyProducts.title, `%${q}%`));

  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds) {
    const mine = await db.select({ id: schema.stores.id }).from(schema.stores)
      .where(and(eq(schema.stores.marketplace, "shopify"), inArray(schema.stores.sellerId, scopeIds)));
    const ids = mine.map((s) => s.id);
    if (!ids.length) return NextResponse.json({ ok: true, rows: [] });
    conds.push(inArray(schema.shopifyProducts.storeId, ids));
  }

  const rows = await db.select({
    id: schema.shopifyProducts.id,
    title: schema.shopifyProducts.title,
    storeId: schema.shopifyProducts.storeId,
    productType: schema.shopifyProducts.productType,
    storeName: schema.stores.name,
  }).from(schema.shopifyProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(and(...conds))
    .orderBy(desc(schema.shopifyProducts.updatedAt))
    .limit(60);

  return NextResponse.json({ ok: true, rows });
}
