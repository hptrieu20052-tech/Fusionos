import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopifyGraphQL, shopHost, type ShopifyCred } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Query lõi — chỉ cần read_products (options/giá/category/collections/type/vendor/theme).
const Q_CORE = `query One($id: ID!) {
  product(id: $id) {
    id title productType vendor templateSuffix
    category { id fullName }
    options { name optionValues { name } }
    variants(first: 100) { nodes { price compareAtPrice sku selectedOptions { name value } } }
    collections(first: 50) { nodes { id title } }
  }
}`;
// Metafields (namespace shopify = category metafields) — có thể cần scope riêng → tách, bỏ qua nếu bị chặn.
const Q_META = `query M($id: ID!) { product(id: $id) { metafields(first: 30, namespace: "shopify") { nodes { namespace key type value } } } }`;
// Sales channels — cần read_publications → tách, bỏ qua nếu bị chặn.
const Q_PUBS = `query P($id: ID!) { product(id: $id) { resourcePublicationsV2(first: 50) { nodes { isPublished publication { id name } } } } }`;

type P = {
  title?: string; productType?: string; vendor?: string; templateSuffix?: string;
  category?: { id?: string; fullName?: string } | null;
  options?: { name?: string; optionValues?: { name?: string }[] }[];
  variants?: { nodes?: { price?: string; compareAtPrice?: string | null; sku?: string; selectedOptions?: { name: string; value: string }[] }[] };
  metafields?: { nodes?: { namespace?: string; key?: string; type?: string; value?: string }[] };
  collections?: { nodes?: { id?: string; title?: string }[] };
  resourcePublicationsV2?: { nodes?: { isPublished?: boolean; publication?: { id?: string; name?: string } }[] };
};

/**
 * GET /api/shopify-templates/from-product?productId=<shopify_products.id>
 * Kéo cấu hình đầy đủ 1 listing Shopify có sẵn → object prefill cho template (options/variants/giá/category/metafields/collection/kênh).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const productId = req.nextUrl.searchParams.get("productId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return NextResponse.json({ ok: false, error: "productId required" }, { status: 400 });

  const [row] = await db.select({ p: schema.shopifyProducts, cred: schema.stores.apiCredentials, seller: schema.stores.sellerId, mk: schema.stores.marketplace })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(eq(schema.shopifyProducts.id, productId)).limit(1);
  if (!row) return NextResponse.json({ ok: false, error: "product not found" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!row.seller || !scopeIds.includes(row.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const cred = (row.cred ?? {}) as ShopifyCred;
  if (row.mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret)))
    return NextResponse.json({ ok: false, error: "store chưa cấu hình Shopify API" }, { status: 400 });

  try {
    const dCore = await shopifyGraphQL<{ product?: P | null }>(cred, Q_CORE, { id: row.p.shopifyProductId });
    const p = dCore.product;
    if (!p) return NextResponse.json({ ok: false, error: "product not found on Shopify" }, { status: 404 });

    const options = (p.options ?? []).map((o) => ({ name: String(o.name ?? ""), values: (o.optionValues ?? []).map((v) => String(v.name ?? "")).filter(Boolean) })).filter((o) => o.name && o.values.length);
    const variants = (p.variants?.nodes ?? []).map((v) => ({
      options: Object.fromEntries((v.selectedOptions ?? []).map((s) => [s.name, s.value])),
      price: v.price != null ? String(v.price) : "0.00",
      compareAtPrice: v.compareAtPrice == null ? null : String(v.compareAtPrice),
      sku: v.sku ? String(v.sku) : "",
    }));
    const collections = (p.collections?.nodes ?? []).map((c) => ({ id: String(c.id ?? ""), title: String(c.title ?? "") })).filter((c) => c.id);

    // Optional: metafields (namespace shopify) — bỏ qua nếu thiếu scope
    const notes: string[] = [];
    let categoryMetafields: { namespace: string; key: string; type: string; value: string }[] = [];
    try {
      const dm = await shopifyGraphQL<{ product?: P | null }>(cred, Q_META, { id: row.p.shopifyProductId });
      categoryMetafields = (dm.product?.metafields?.nodes ?? []).map((m) => ({ namespace: String(m.namespace ?? ""), key: String(m.key ?? ""), type: String(m.type ?? ""), value: String(m.value ?? "") })).filter((m) => m.key && m.value);
    } catch { notes.push("category metafields skipped (needs read_products/metafields scope)"); }

    // Optional: sales channels — cần read_publications
    let publications: { id: string; name: string }[] = [];
    try {
      const dp = await shopifyGraphQL<{ product?: P | null }>(cred, Q_PUBS, { id: row.p.shopifyProductId });
      publications = (dp.product?.resourcePublicationsV2?.nodes ?? []).filter((n) => n.isPublished && n.publication?.id).map((n) => ({ id: String(n.publication!.id), name: String(n.publication!.name ?? "") }));
    } catch { notes.push("sales channels skipped — add `read_publications` scope to the app + reinstall to include channels"); }

    return NextResponse.json({
      ok: true,
      ...(notes.length ? { note: notes.join(" · ") } : {}),
      prefill: {
        storeId: row.p.storeId,
        sourceTitle: p.title ?? row.p.title,
        productType: p.productType ?? "",
        vendor: p.vendor ?? "",
        themeTemplate: p.templateSuffix ?? "",
        category: p.category?.id ? { id: String(p.category.id), name: String(p.category.fullName ?? "") } : null,
        options, variants, categoryMetafields,
        collections, publications,
        collectionIds: collections.map((c) => c.id),
        publicationIds: publications.map((c) => c.id),
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 250) }, { status: 500 });
  }
}
