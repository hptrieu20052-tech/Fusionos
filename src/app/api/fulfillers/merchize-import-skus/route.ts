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

  let catalogRaw;
  try { catalogRaw = await getMerchizeCatalog(baseUrl, apiKey, { limit: 50, page: 1, search: b.search || undefined }); }
  catch (e) { return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 502 }); }

  // Gom SKU: (a) nếu catalog có sẵn SKU thì dùng luôn; (b) else gọi all-variants từng product.
  type Row = { sku: string; title: string; cost: number; productId?: string };
  const rows: Row[] = [...extractMerchizeCatalog(catalogRaw)];
  let variantSample: unknown = null;
  if (rows.length === 0) {
    const products = extractMerchizeProducts(catalogRaw).slice(0, 40); // trần an toàn 40 product/lần
    for (const p of products) {
      try {
        const vraw = await getMerchizeVariants(baseUrl, apiKey, p.productId);
        if (!variantSample) variantSample = Array.isArray((vraw as Record<string, unknown>)?.data) ? ((vraw as Record<string, unknown>).data as unknown[])[0] : vraw;
        for (const v of extractMerchizeVariants(vraw)) rows.push({ ...v, productId: p.productId, title: `${p.title}${v.title ? " · " + v.title : ""}`.trim() });
      } catch { /* bỏ qua product lỗi */ }
    }
  }

  const existing = await db.select({ sku: schema.skuMappings.internalSku }).from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
  const have = new Set(existing.map((x) => x.sku));
  let created = 0, skipped = 0;
  const seen = new Set<string>();
  for (const it of rows) {
    if (have.has(it.sku) || seen.has(it.sku)) { skipped++; continue; }
    seen.add(it.sku);
    try {
      await db.insert(schema.skuMappings).values({
        internalSku: it.sku, fulfillerId: ff.id, fulfillerSku: it.sku,
        fulfillerProduct: it.title?.slice(0, 200) || null,
        fulfillerProductId: it.productId ?? null,
        baseCost: it.cost.toFixed(2), shipCost: "0",
      });
      created++;
    } catch { skipped++; }
  }

  const d = catalogRaw as Record<string, unknown>;
  const arr = (Array.isArray(d) ? d : d.data ?? d.products ?? d.items ?? []) as unknown[];
  const rawSample = Array.isArray(arr) ? arr[0] ?? null : null;

  return NextResponse.json({ ok: true, found: rows.length, created, skipped, rawSample, variantSample });
}
