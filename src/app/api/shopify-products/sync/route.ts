import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopHost, type ShopifyCred } from "@/lib/shopify";
import { fetchAllShopifyProducts } from "@/lib/shopify-products";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/shopify-products/sync { storeId } — kéo toàn bộ sản phẩm của 1 store Shopify về FUSION.
 * KHÔNG đè bản đang sửa dở (dirty=true) để không mất chỉnh sửa chưa Push.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const storeId = String(b?.storeId ?? "").trim();
  if (!storeId) return NextResponse.json({ ok: false, error: "storeId required" }, { status: 400 });

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store || store.marketplace !== "shopify") return NextResponse.json({ ok: false, error: "not a Shopify store" }, { status: 400 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!store.sellerId || !scopeIds.includes(store.sellerId))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const cred = (store.apiCredentials ?? {}) as ShopifyCred;
  if (!shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
    return NextResponse.json({ ok: false, error: "Shopify store chưa cấu hình API" }, { status: 400 });
  }

  let products;
  try { products = await fetchAllShopifyProducts(cred); }
  catch (e) {
    const msg = String((e as Error)?.message ?? e);
    return NextResponse.json({ ok: false, error: msg.slice(0, 250) + (/read_products|access|scope|Not Found|401|403/i.test(msg) ? " — thêm scope read_products + Install lại app" : "") }, { status: 200 });
  }

  // Bản ghi hiện có của store → biết cái nào dirty (giữ lại) / cái nào update
  const existing = await db.select({ id: schema.shopifyProducts.id, gid: schema.shopifyProducts.shopifyProductId, dirty: schema.shopifyProducts.dirty })
    .from(schema.shopifyProducts).where(eq(schema.shopifyProducts.storeId, storeId));
  const byGid = new Map(existing.map((r) => [r.gid, r]));

  let created = 0, updated = 0, skippedDirty = 0;
  for (const p of products) {
    const row = {
      storeId, shopifyProductId: p.shopifyProductId, handle: p.handle, title: p.title, bodyHtml: p.bodyHtml,
      vendor: p.vendor, productType: p.productType, tags: p.tags, status: p.status,
      seoTitle: p.seoTitle, seoDescription: p.seoDescription,
      options: p.options, variants: p.variants, images: p.images,
      onlineStoreUrl: p.onlineStoreUrl, totalInventory: p.totalInventory,
      dirty: false, syncedAt: new Date(), updatedAt: new Date(),
    };
    const cur = byGid.get(p.shopifyProductId);
    if (!cur) { await db.insert(schema.shopifyProducts).values(row); created++; }
    else if (cur.dirty) { await db.update(schema.shopifyProducts).set({ syncedAt: new Date() }).where(eq(schema.shopifyProducts.id, cur.id)); skippedDirty++; }
    else { await db.update(schema.shopifyProducts).set(row).where(eq(schema.shopifyProducts.id, cur.id)); updated++; }
  }
  return NextResponse.json({ ok: true, store: store.name, total: products.length, created, updated, skippedDirty });
}
