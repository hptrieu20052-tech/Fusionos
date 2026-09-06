import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * v405 · GET /api/shopbase-templates/from-product?productId=<uuid>
 * Prefill template ShopBase từ 1 sản phẩm ĐÃ SYNC trong shopbase_products (không gọi API):
 * thumb = ảnh đầu, options/variants + giá/sku theo đúng sản phẩm, type/vendor/collections copy theo.
 */
type Vari = { price?: string; compareAtPrice?: string | null; sku?: string; selectedOptions?: { name: string; value: string }[] };
type Img = { src?: string; position?: number };

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const productId = String(req.nextUrl.searchParams.get("productId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return NextResponse.json({ ok: false, error: "productId required" }, { status: 400 });

  const [row] = await db.select({ p: schema.shopbaseProducts, sellerId: schema.stores.sellerId, mk: schema.stores.marketplace })
    .from(schema.shopbaseProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopbaseProducts.storeId))
    .where(eq(schema.shopbaseProducts.id, productId)).limit(1);
  if (!row || row.mk !== "shopbase") return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && !(row.sellerId && scopeIds.includes(row.sellerId))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const p = row.p;
  const options = ((Array.isArray(p.options) ? p.options : []) as { name?: string; values?: string[] }[])
    .map((o) => ({ name: String(o?.name ?? "").trim(), values: (Array.isArray(o?.values) ? o.values : []).map(String).filter(Boolean) }))
    .filter((o) => o.name && o.values.length).slice(0, 3);
  const variants = ((Array.isArray(p.variants) ? p.variants : []) as Vari[]).slice(0, 100).map((v) => ({
    options: Object.fromEntries((v.selectedOptions ?? []).map((s) => [s.name, s.value])),
    price: String(v.price ?? "0.00"),
    compareAtPrice: v.compareAtPrice ?? null,
    sku: String(v.sku ?? ""),
  }));
  const imgs = ((Array.isArray(p.images) ? p.images : []) as Img[])
    .slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99));
  const thumbUrl = imgs.map((i) => String(i?.src ?? "")).find((s) => /^https?:\/\//i.test(s)) ?? null;

  return NextResponse.json({
    ok: true,
    prefill: {
      storeId: p.storeId,
      sourceTitle: p.title,
      thumbUrl,
      options,
      variants,
      collections: (Array.isArray(p.collections) ? p.collections : []) as { id: string; title: string }[],
      productType: p.productType ?? "",
      vendor: p.vendor ?? "",
      description: p.bodyHtml ?? "",
    },
  });
}
