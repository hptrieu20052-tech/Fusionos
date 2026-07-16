import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, sql, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { readTtCfg, ttGetValidCfg, ttSearchProducts } from "@/lib/tiktok-shop";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Trích field hiển thị từ product của API (shape linh hoạt → lấy phòng thủ).
function extract(p: Record<string, unknown>) {
  const imgs = (p.main_images as { uri?: string; urls?: string[]; thumb_urls?: string[] }[] | undefined) ?? [];
  const img0 = imgs[0];
  const mainImageUrl = img0?.urls?.[0] ?? img0?.thumb_urls?.[0] ?? null;
  const skus = (p.skus as { seller_sku?: string; price?: { sale_price?: string; tax_exclusive_price?: string } }[] | undefined) ?? [];
  const sellerSku = skus[0]?.seller_sku ?? null;
  const prices = skus.map((s) => Number(s.price?.sale_price ?? s.price?.tax_exclusive_price ?? 0)).filter((n) => n > 0);
  const priceMin = prices.length ? Math.min(...prices) : null;
  const cat = (p.category_chains as { id?: string; local_name?: string; is_leaf?: boolean }[] | undefined) ?? [];
  const leaf = cat.find((c) => c.is_leaf) ?? cat[cat.length - 1];
  const toTs = (v: unknown) => (v ? new Date(Number(v) * 1000) : null);
  return {
    tiktokProductId: String(p.id ?? ""),
    title: (p.title as string) ?? null,
    status: (p.status as string) ?? null,
    mainImageUrl,
    categoryId: leaf?.id ?? null,
    categoryName: leaf?.local_name ?? null,
    sellerSku,
    priceMin: priceMin != null ? String(priceMin) : null,
    ttCreateTime: toTs(p.create_time),
    ttUpdateTime: toTs(p.update_time),
    raw: p,
  };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const onlyStore = b?.storeId as string | undefined;

  // Phạm vi: seller chỉ được sync store MÌNH (store.sellerId ∈ scope). admin/all → mọi store.
  const scopeIds = await storeOwnerScopeIds(session);
  const storeWhere = scopeIds ? inArray(schema.stores.sellerId, scopeIds) : undefined;
  const stores = await db.select({ id: schema.stores.id, name: schema.stores.name, c: schema.stores.apiCredentials }).from(schema.stores).where(storeWhere);
  const ttStores = stores.filter((s) => readTtCfg((s.c ?? null) as Record<string, string> | null).refreshToken && (!onlyStore || s.id === onlyStore));

  const deadline = Date.now() + 270_000;
  const result: { store: string; synced: number; error?: string }[] = [];

  for (const st of ttStores) {
    if (Date.now() > deadline) break;
    let synced = 0;
    try {
      const cfg = await ttGetValidCfg(st.id, (st.c ?? null) as Record<string, string> | null);
      let pageToken = "";
      for (let page = 0; page < 60; page++) {
        if (Date.now() > deadline) break;
        const { products, nextPageToken } = await ttSearchProducts(cfg, { status: "ALL" }, pageToken || undefined, 100);
        for (const p of products) {
          const row = extract(p);
          if (!row.tiktokProductId) continue;
          await db.insert(schema.tiktokProducts).values({ storeId: st.id, ...row })
            .onConflictDoUpdate({
              target: [schema.tiktokProducts.storeId, schema.tiktokProducts.tiktokProductId],
              set: { ...row, syncedAt: sql`now()` },
            });
          synced++;
        }
        if (!nextPageToken) break;
        pageToken = nextPageToken;
      }
      result.push({ store: st.name, synced });
    } catch (e) {
      result.push({ store: st.name, synced, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  return NextResponse.json({ ok: true, stores: result });
}
