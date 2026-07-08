import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getMerchizeCatalog, extractMerchizeCatalog, extractMerchizeProducts, getMerchizeVariants, extractMerchizeVariants } from "@/lib/merchize";

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
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "thiếu fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller không tồn tại" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; apiToken?: string };
  const apiKey = c.apiKey || c.apiToken;
  const baseUrl = ff.apiEndpoint;
  if (!apiKey || !baseUrl) return NextResponse.json({ ok: false, error: "Chưa cấu hình Base URL + API Key cho Merchize" }, { status: 400 });

  // ---- 1. Phân trang catalog: lấy TOÀN BỘ product ----
  const start = Date.now();
  type Prod = { productId: string; title: string };
  const products: Prod[] = [];
  const directRows: { sku: string; title: string; cost: number; productId?: string; variant?: string }[] = [];
  let catalogSample: unknown = null;
  try {
    for (let page = 1; page <= 40; page++) {
      if (Date.now() - start > 15000) break; // giới hạn thời gian phân trang
      const raw = await getMerchizeCatalog(baseUrl, apiKey, { limit: 50, page, search: b.search || undefined });
      if (!catalogSample) { const dd = raw as Record<string, unknown>; const a = (Array.isArray(dd) ? dd : dd.data ?? dd.products ?? dd.items ?? []) as unknown[]; catalogSample = Array.isArray(a) ? a[0] ?? null : null; }
      const direct = extractMerchizeCatalog(raw);
      if (direct.length) directRows.push(...direct); // catalog có sẵn SKU
      const ps = extractMerchizeProducts(raw);
      products.push(...ps);
      if (ps.length < 50 && direct.length < 50) break; // hết trang
    }
  } catch (e) { return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 502 }); }

  // ---- 2. Bỏ qua product ĐÃ kéo (theo product_id) → khỏi gọi all-variants lại; kéo tăng dần ----
  const existingMaps = await db.select({ sku: schema.skuMappings.internalSku, pid: schema.skuMappings.fulfillerProductId }).from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
  const have = new Set(existingMaps.map((x) => x.sku));
  const doneProducts = new Set(existingMaps.map((x) => x.pid).filter(Boolean) as string[]);

  type Row = { sku: string; productType: string; variant: string; cost: number; productId?: string };
  const rows: Row[] = directRows.map((d) => ({ sku: d.sku, productType: d.title, variant: d.variant ?? "", cost: d.cost, productId: d.productId }));
  let variantSample: unknown = null;
  const uniqueProducts = Array.from(new Map(products.map((p) => [p.productId, p])).values());
  const todo = uniqueProducts.filter((p) => !doneProducts.has(p.productId)); // chỉ product chưa kéo
  let processed = 0;
  const BATCH = 6, BUDGET_MS = 45000; // tổng thời gian an toàn dưới giới hạn Vercel
  for (let i = 0; i < todo.length; i += BATCH) {
    if (Date.now() - start > BUDGET_MS) break; // hết ngân sách → dừng, lần sau kéo tiếp
    const batch = todo.slice(i, i + BATCH);
    await Promise.all(batch.map(async (p) => {
      try {
        const vraw = await getMerchizeVariants(baseUrl, apiKey, p.productId);
        if (!variantSample) { const vd = vraw as Record<string, unknown>; variantSample = Array.isArray(vd?.data) ? (vd.data as unknown[])[0] : vraw; }
        for (const v of extractMerchizeVariants(vraw)) rows.push({ sku: v.sku, productType: p.title, variant: v.title, cost: v.cost, productId: p.productId });
        processed++;
      } catch { /* bỏ qua product lỗi */ }
    }));
  }

  let created = 0, skipped = 0;
  const seen = new Set<string>();
  // Trùng SKU: ưu tiên dòng CÓ nhãn variant (màu/size từ all-variants) hơn dòng catalog phẳng (variant rỗng)
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
        baseCost: it.cost.toFixed(2), shipCost: "0",
      });
      created++;
    } catch { skipped++; }
  }

  const remaining = todo.length - processed;
  const done = remaining <= 0;
  return NextResponse.json({
    ok: true, found: rows.length, created, skipped,
    productsTotal: uniqueProducts.length, productsProcessed: processed, remaining, done,
    rawSample: catalogSample, variantSample,
  });
}
