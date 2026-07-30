import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopHost, type ShopifyCred } from "@/lib/shopify";
import { pushProductToShopify, type SyncedVariant, type SyncedImage } from "@/lib/shopify-products";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/shopify-products/push { ids } — đẩy chỉnh sửa local lên Shopify (productUpdate + variants + media).
 * Thành công → dirty=false, pushedAt=now.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 50);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });

  const rows = await db.select({ p: schema.shopifyProducts, cred: schema.stores.apiCredentials, seller: schema.stores.sellerId, mk: schema.stores.marketplace })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const results: { id: string; title: string; ok: boolean; error?: string }[] = [];
  for (const r of rows) {
    const cred = (r.cred ?? {}) as ShopifyCred;
    if (r.mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
      results.push({ id: r.p.id, title: r.p.title, ok: false, error: "store chưa cấu hình Shopify API" }); continue;
    }
    try {
      const res = await pushProductToShopify(cred, {
        shopifyProductId: r.p.shopifyProductId, title: r.p.title, bodyHtml: r.p.bodyHtml, tags: r.p.tags,
        status: r.p.status, vendor: r.p.vendor, productType: r.p.productType,
        variants: (Array.isArray(r.p.variants) ? r.p.variants as SyncedVariant[] : []),
        images: (Array.isArray(r.p.images) ? r.p.images as SyncedImage[] : []),
      });
      if (res.ok) {
        await db.update(schema.shopifyProducts).set({ dirty: false, pushedAt: new Date(), updatedAt: new Date() }).where(eq(schema.shopifyProducts.id, r.p.id));
        results.push({ id: r.p.id, title: r.p.title, ok: true });
      } else results.push({ id: r.p.id, title: r.p.title, ok: false, error: res.error });
    } catch (e) {
      results.push({ id: r.p.id, title: r.p.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  const pushed = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: pushed > 0, pushed, failed: results.length - pushed, results });
}
