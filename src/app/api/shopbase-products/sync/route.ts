import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopbaseConfigured, touchShopBaseSync, type ShopBaseCred } from "@/lib/shopbase";
import { fetchAllShopbaseProducts } from "@/lib/shopbase-products";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/shopbase-products/sync { storeId }
 * Kéo toàn bộ sản phẩm ShopBase (REST) → upsert vào shopbase_products (khóa shopbase_product_id).
 * Bản có dirty=true (đang sửa local chưa push) chỉ bump synced_at, KHÔNG ghi đè. Độc lập hệ Shopify.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const storeId = String(b?.storeId ?? "").trim();
  if (!storeId) return NextResponse.json({ ok: false, error: "missing storeId" }, { status: 400 });

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) return NextResponse.json({ ok: false, error: "store not found" }, { status: 404 });
  if (store.marketplace !== "shopbase") return NextResponse.json({ ok: false, error: "not a ShopBase store" }, { status: 400 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!store.sellerId || !scopeIds.includes(store.sellerId))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const cred = ((store.apiCredentials ?? {}) as Record<string, unknown>).shopbase as ShopBaseCred | undefined;
  if (!shopbaseConfigured(cred ?? null)) {
    return NextResponse.json({ ok: false, error: "ShopBase store chưa cấu hình — nhập Subdomain + API key + Password ở Stores rồi Check." }, { status: 400 });
  }

  let products;
  try {
    products = await fetchAllShopbaseProducts(cred!);
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 250) }, { status: 200 });
  }

  const existing = await db.select({ id: schema.shopbaseProducts.id, pid: schema.shopbaseProducts.shopbaseProductId, dirty: schema.shopbaseProducts.dirty })
    .from(schema.shopbaseProducts).where(eq(schema.shopbaseProducts.storeId, storeId));
  const byPid = new Map(existing.map((r) => [r.pid, r]));

  let created = 0, updated = 0, skippedDirty = 0;
  for (const p of products) {
    const row = {
      storeId, shopbaseProductId: p.shopbaseProductId, handle: p.handle, title: p.title || "(no title)",
      bodyHtml: p.bodyHtml, vendor: p.vendor, productType: p.productType, tags: p.tags, status: p.status,
      seoTitle: p.seoTitle, seoDescription: p.seoDescription,
      collections: p.collections, options: p.options, variants: p.variants, images: p.images,
      onlineStoreUrl: p.onlineStoreUrl, totalInventory: p.totalInventory,
    };
    const hit = byPid.get(p.shopbaseProductId);
    if (!hit) {
      await db.insert(schema.shopbaseProducts).values(row);
      created++;
    } else if (hit.dirty) {
      await db.update(schema.shopbaseProducts).set({ syncedAt: new Date() }).where(eq(schema.shopbaseProducts.id, hit.id));
      skippedDirty++;
    } else {
      await db.update(schema.shopbaseProducts).set({ ...row, syncedAt: new Date(), updatedAt: new Date() }).where(eq(schema.shopbaseProducts.id, hit.id));
      updated++;
    }
  }

  await touchShopBaseSync(storeId);
  return NextResponse.json({ ok: true, fetched: products.length, created, updated, skippedDirty });
}
