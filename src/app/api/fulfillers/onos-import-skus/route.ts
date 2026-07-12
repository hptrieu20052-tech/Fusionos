import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listOnosProducts, getOnosProductVariants } from "@/lib/onos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId } — kéo catalog ONOS 2 bước (list /products KHÔNG kèm variants):
 *   1. GET /products (phân trang) → danh sách product
 *   2. GET /products/{id} từng SP → variants (SKU con + Color/Size + giá)
 * Kéo TĂNG DẦN: product đã có variant trong mapping (theo fulfiller_product_id) thì bỏ qua,
 * bấm Update SKU nhiều lần đến khi done. Trả kèm rawSample/detailSample để soi khi parse lệch.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; accessToken?: string; apiToken?: string };
  const apiKey = c.apiKey || c.accessToken || c.apiToken;
  if (!apiKey) return NextResponse.json({ ok: false, error: "ONOS token not configured (Settings → API Key: paste token or email:password)" }, { status: 400 });

  const cred = { apiKey, endpoint: ff.apiEndpoint };
  const start = Date.now();
  type Row = { sku: string; productType: string; variant: string; cost: number; ship: number; productId?: string };
  const rows: Row[] = [];
  type Prod = { productId: string; title: string };
  const products: Prod[] = [];
  let sample: unknown = null;
  let listDone = false;
  try {
    for (let page = 1; page <= 40; page++) {
      if (Date.now() - start > 15000) break; // giới hạn thời gian list, chừa budget cho detail
      const r = await listOnosProducts(cred, page, 100);
      if (!sample) sample = r.sample;
      for (const v of r.variants) {
        // Dòng list CÓ variant sẵn thì dùng luôn; dòng product trần chỉ ghi vào danh sách chờ detail
        if (v.variant) rows.push({ sku: v.sku, productType: v.product, variant: v.variant, cost: v.price ?? 0, ship: v.ship ?? 0, productId: v.productId });
        products.push({ productId: v.productId, title: v.product });
      }
      if (!r.hasMore) { listDone = true; break; }
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }

  // ---- Mapping hiện có: bỏ qua SKU đã kéo; product ĐÃ có variant (theo product_id) khỏi gọi detail lại ----
  const existing = await db.select({ sku: schema.skuMappings.internalSku, pid: schema.skuMappings.fulfillerProductId, variant: schema.skuMappings.variant })
    .from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
  const have = new Set(existing.map((x) => x.sku));
  const doneProducts = new Set(existing.filter((x) => x.variant).map((x) => x.pid).filter(Boolean) as string[]);

  // ---- Bước 2: gọi detail cho product chưa có variant ----
  const uniqueProducts = Array.from(new Map(products.map((p) => [p.productId, p])).values());
  const todo = uniqueProducts.filter((p) => p.productId && !doneProducts.has(p.productId));
  let detailSample: unknown = null;
  let processed = 0;
  let detailDone = true;
  const BATCH = 6, BUDGET_MS = 42000;
  for (let i = 0; i < todo.length; i += BATCH) {
    if (Date.now() - start > BUDGET_MS) { detailDone = false; break; }
    const batch = todo.slice(i, i + BATCH);
    await Promise.all(batch.map(async (p) => {
      try {
        const r = await getOnosProductVariants(cred, p.productId);
        if (!detailSample) detailSample = r.sample;
        for (const v of r.variants) rows.push({ sku: v.sku, productType: p.title || v.product, variant: v.variant, cost: v.price ?? 0, ship: v.ship ?? 0, productId: p.productId });
        processed++;
      } catch { /* bỏ qua product lỗi */ }
    }));
  }

  let created = 0, skipped = 0;
  const seen = new Set<string>();
  rows.sort((a, b2) => (b2.variant ? 1 : 0) - (a.variant ? 1 : 0)); // ưu tiên dòng CÓ variant
  for (const it of rows) {
    if (!it.sku || have.has(it.sku) || seen.has(it.sku)) { skipped++; continue; }
    seen.add(it.sku);
    try {
      await db.insert(schema.skuMappings).values({
        internalSku: it.sku, fulfillerId: ff.id, fulfillerSku: it.sku,
        productType: it.productType?.slice(0, 120) || null,
        fulfillerProduct: it.productType?.slice(0, 200) || null,
        variant: it.variant?.slice(0, 120) || null,
        fulfillerProductId: it.productId ?? null,
        baseCost: it.cost.toFixed(2), shipCost: (it.ship ?? 0).toFixed(2),
      });
      created++;
    } catch { skipped++; }
  }

  const done = listDone && detailDone && processed >= todo.length;
  return NextResponse.json({
    ok: true, found: rows.length, created, skipped, done,
    productsTotal: uniqueProducts.length, productsProcessed: processed, productsPending: Math.max(0, todo.length - processed),
    rawSample: sample, detailSample,
  });
}
