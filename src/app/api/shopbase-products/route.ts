import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

type Variant = { price?: string; sku?: string };
type Img = { src?: string; position?: number };

/** GET /api/shopbase-products — danh sách sản phẩm ShopBase (lọc client-side như trang Shopify). */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const rows = await db.select({
    p: schema.shopbaseProducts,
    storeName: schema.stores.name,
    sellerId: schema.stores.sellerId,
    sellerName: schema.users.fullName,
    marketplace: schema.stores.marketplace,
  }).from(schema.shopbaseProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopbaseProducts.storeId))
    .leftJoin(schema.users, eq(schema.users.id, schema.stores.sellerId))
    .where(eq(schema.stores.marketplace, "shopbase"))
    .orderBy(desc(schema.shopbaseProducts.updatedAt));

  const scopeIds = await storeOwnerScopeIds(session);
  const scoped = scopeIds ? rows.filter((r) => r.sellerId && scopeIds.includes(r.sellerId)) : rows;

  const out = scoped.map((r) => {
    const vars = (Array.isArray(r.p.variants) ? r.p.variants : []) as Variant[];
    const prices = vars.map((v) => Number(v.price)).filter((n) => n > 0);
    const imgs = (Array.isArray(r.p.images) ? r.p.images : []) as Img[];
    const thumb = imgs.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99)).map((i) => String(i?.src ?? ""))
      .find((s) => /^https?:\/\//i.test(s)) ?? null;
    const skuTotal = vars.length;
    const skuDone = vars.filter((v) => String(v.sku ?? "").trim()).length;
    return {
      id: r.p.id, storeId: r.p.storeId, storeName: r.storeName ?? "—",
      sellerId: r.sellerId ?? null, sellerName: r.sellerName ?? "—",
      shopbaseProductId: r.p.shopbaseProductId, handle: r.p.handle ?? "",
      title: r.p.title, productType: r.p.productType ?? "", tags: r.p.tags ?? "",
      status: r.p.status, collections: r.p.collections ?? [],
      onlineStoreUrl: r.p.onlineStoreUrl ?? null, totalInventory: r.p.totalInventory ?? null,
      dirty: r.p.dirty, variantCount: vars.length, imageCount: imgs.length,
      priceMin: prices.length ? Math.min(...prices) : null,
      priceMax: prices.length ? Math.max(...prices) : null,
      skuDone, skuTotal, thumb,
      syncedAt: r.p.syncedAt, updatedAt: r.p.updatedAt,
    };
  });

  return NextResponse.json({ ok: true, rows: out });
}
