import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopHost, type ShopifyCred } from "@/lib/shopify";
import { applyTemplate, type Template } from "@/lib/shopify-template";
import { fetchOneShopifyProduct } from "@/lib/shopify-products";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/shopify-products/apply-template { ids, templateId }
 * Áp full-preset template lên các listing Shopify ĐÃ CÓ (productSet đổi cả cấu trúc variants) rồi đồng bộ lại bản local.
 * Chỉ áp cho product cùng store với template (collection/kênh theo store).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const templateId = String(b?.templateId ?? "");
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 100);
  if (!/^[0-9a-f-]{36}$/i.test(templateId) || !ids.length) return NextResponse.json({ ok: false, error: "templateId + ids required" }, { status: 400 });

  const [tpl] = await db.select().from(schema.shopifyTemplates).where(eq(schema.shopifyTemplates.id, templateId)).limit(1);
  if (!tpl) return NextResponse.json({ ok: false, error: "template not found" }, { status: 404 });

  const rows = await db.select({ p: schema.shopifyProducts, cred: schema.stores.apiCredentials, seller: schema.stores.sellerId, mk: schema.stores.marketplace })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (rows.some((r) => !r.seller || !scopeIds.includes(r.seller)) || !tpl)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const template = tpl as unknown as Template;
  const targets = rows.filter((r) => r.p.storeId === tpl.storeId);
  const skipped = rows.length - targets.length;

  const results: { id: string; title: string; ok: boolean; error?: string }[] = [];
  for (const r of targets) {
    const cred = (r.cred ?? {}) as ShopifyCred;
    if (r.mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
      results.push({ id: r.p.id, title: r.p.title, ok: false, error: "store chưa cấu hình Shopify API" }); continue;
    }
    const res = await applyTemplate(cred, template, { id: r.p.shopifyProductId, title: r.p.title, descriptionHtml: r.p.bodyHtml ?? "" }, { includeImages: false });
    if (!res.ok) { results.push({ id: r.p.id, title: r.p.title, ok: false, error: res.error }); continue; }
    // Đồng bộ lại bản local (variant GID mới, options, giá…)
    try {
      const fresh = await fetchOneShopifyProduct(cred, r.p.shopifyProductId);
      if (fresh) {
        await db.update(schema.shopifyProducts).set({
          handle: fresh.handle, title: fresh.title, bodyHtml: fresh.bodyHtml, vendor: fresh.vendor, productType: fresh.productType,
          tags: fresh.tags, status: fresh.status, seoTitle: fresh.seoTitle, seoDescription: fresh.seoDescription, category: fresh.category, collections: fresh.collections, options: fresh.options, variants: fresh.variants, images: fresh.images,
          onlineStoreUrl: fresh.onlineStoreUrl, totalInventory: fresh.totalInventory, templateId: tpl.id, dirty: false, syncedAt: new Date(), pushedAt: new Date(), updatedAt: new Date(),
        }).where(eq(schema.shopifyProducts.id, r.p.id));
      } else {
        await db.update(schema.shopifyProducts).set({ templateId: tpl.id, dirty: false, pushedAt: new Date(), updatedAt: new Date() }).where(eq(schema.shopifyProducts.id, r.p.id));
      }
    } catch { /* refetch lỗi không chặn — sản phẩm đã áp xong trên Shopify */ }
    results.push({ id: r.p.id, title: r.p.title, ok: true, ...(res.error ? { error: res.error } : {}) });
  }

  const done = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: done > 0, done, failed: results.length - done, skipped, results });
}
