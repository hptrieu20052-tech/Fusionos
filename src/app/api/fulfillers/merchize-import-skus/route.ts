import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getMerchizeCatalog, extractMerchizeCatalog, extractMerchizeProducts, getMerchizeVariants, extractMerchizeVariants, extractCatalogProducts } from "@/lib/merchize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId, search? } — kéo catalog Merchize → all-variants từng product → tạo SKU mapping.
 * fulfiller_sku = merchize_sku (variant), fulfiller_product_id = product_id, base_cost = variant cost.
 * Trả kèm rawSample để soi cấu trúc nếu parse chưa khớp.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; apiToken?: string };
  const apiKey = c.apiKey || c.apiToken;
  const baseUrl = ff.apiEndpoint;
  if (!apiKey || !baseUrl) return NextResponse.json({ ok: false, error: "Base URL + API Key not configured for Merchize" }, { status: 400 });

  // ---- 1. Phân trang catalog: lấy TOÀN BỘ product ----
  const start = Date.now();
  type Prod = { productId: string; title: string };
  const products: Prod[] = [];
  const directRows: { sku: string; title: string; cost: number; productId?: string; variant?: string; ship?: number }[] = [];
  let catalogSample: unknown = null;
  let catalogDone = false;
  try {
    for (let page = 1; page <= 60; page++) {
      if (Date.now() - start > 15000) break; // giới hạn thời gian phân trang
      const raw = await getMerchizeCatalog(baseUrl, apiKey, { limit: 50, page, search: b.search || undefined });
      if (!catalogSample) { const dd = raw as Record<string, unknown>; const a = (Array.isArray(dd) ? dd : dd.data ?? dd.products ?? dd.items ?? []) as unknown[]; catalogSample = Array.isArray(a) ? a[0] ?? null : null; }
      const pageProducts = extractCatalogProducts(raw);
      const direct = extractMerchizeCatalog(raw);
      if (direct.length) directRows.push(...direct); // catalog kèm variant + màu/size + giá
      const ps = extractMerchizeProducts(raw);
      products.push(...ps);
      if (pageProducts.length < 50) { catalogDone = true; break; } // hết trang
    }
  } catch (e) { return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 }); }

  // ---- 2. Bỏ qua product ĐÃ kéo (theo product_id) → khỏi gọi all-variants lại; kéo tăng dần ----
  const existingMaps = await db.select({ sku: schema.skuMappings.internalSku, pid: schema.skuMappings.fulfillerProductId }).from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
  const have = new Set(existingMaps.map((x) => x.sku));
  const doneProducts = new Set(existingMaps.map((x) => x.pid).filter(Boolean) as string[]);

  type Row = { sku: string; productType: string; variant: string; cost: number; ship: number; productId?: string };
  const rows: Row[] = directRows.map((d) => ({ sku: d.sku, productType: d.title, variant: d.variant ?? "", cost: d.cost, ship: d.ship ?? 0, productId: d.productId }));
  let variantSample: unknown = null;
  const uniqueProducts = Array.from(new Map(products.map((p) => [p.productId, p])).values());
  let processed = 0;
  // Catalog đã kèm đủ variant + màu/size + giá → KHÔNG cần gọi all-variants (trước đây gọi cả trăm lần → timeout).
  // Chỉ fallback all-variants nếu catalog KHÔNG trả variant nào.
  if (directRows.length === 0 && uniqueProducts.length) {
    const todo = uniqueProducts.filter((p) => !doneProducts.has(p.productId));
    const BATCH = 6, BUDGET_MS = 45000;
    for (let i = 0; i < todo.length; i += BATCH) {
      if (Date.now() - start > BUDGET_MS) break;
      const batch = todo.slice(i, i + BATCH);
      await Promise.all(batch.map(async (p) => {
        try {
          const vraw = await getMerchizeVariants(baseUrl, apiKey, p.productId);
          if (!variantSample) { const vd = vraw as Record<string, unknown>; variantSample = Array.isArray(vd?.data) ? (vd.data as unknown[])[0] : vraw; }
          for (const v of extractMerchizeVariants(vraw)) rows.push({ sku: v.sku, productType: p.title, variant: v.title, cost: v.cost, ship: 0, productId: p.productId });
          processed++;
        } catch { /* bỏ qua product lỗi */ }
      }));
    }
  }

  let created = 0, skipped = 0;
  const seen = new Set<string>();
  // Trùng SKU: ưu tiên dòng CÓ nhãn variant hơn dòng trống
  rows.sort((a, b) => (b.variant ? 1 : 0) - (a.variant ? 1 : 0));
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

  const done = catalogDone;
  return NextResponse.json({
    ok: true, found: rows.length, created, skipped,
    productsTotal: uniqueProducts.length, productsProcessed: processed, done,
    rawSample: catalogSample, variantSample,
  });
}
