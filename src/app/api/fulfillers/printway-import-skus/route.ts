import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listPrintwaySkuCatalogs, normalizePwSkuRow } from "@/lib/printway-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId } — kéo catalog SKU Printway (GET /products/list-sku-catalogs) → tạo SKU mapping.
 * fulfiller_sku = item_sku, fulfiller_product_id = variant_id (dùng cho shipping methods / create order),
 * base_cost = giá catalog nếu có. Trả kèm rawSample để soi cấu trúc nếu parse chưa khớp.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; accessToken?: string; apiToken?: string };
  const accessToken = c.apiKey || c.accessToken || c.apiToken;
  if (!accessToken) return NextResponse.json({ ok: false, error: "Printway Access Token not configured (Settings → API Key)" }, { status: 400 });

  // ---- Kéo catalog: thử phân trang; nếu server bỏ qua page thì tự dừng khi trùng dữ liệu ----
  const start = Date.now();
  type Row = ReturnType<typeof normalizePwSkuRow>;
  const rows: Row[] = [];
  let rawSample: unknown = null;
  const firstSkuOfPage = new Set<string>();
  try {
    for (let page = 1; page <= 40; page++) {
      if (Date.now() - start > 40000) break;
      const { items, raw } = await listPrintwaySkuCatalogs({ accessToken, endpoint: ff.apiEndpoint }, page, 100);
      if (!rawSample) rawSample = Array.isArray(items) && items.length ? items[0] : raw;
      if (!items.length) break;
      const key = JSON.stringify(items[0]).slice(0, 200);
      if (firstSkuOfPage.has(key)) break; // server bỏ qua ?page → trang lặp lại
      firstSkuOfPage.add(key);
      for (const it of items) {
        const n = normalizePwSkuRow(it);
        if (n.sku || n.variantId) rows.push(n);
      }
      if (items.length < 100) break;
      await new Promise((r) => setTimeout(r, 120)); // rate limit 50 req/3s
    }
  } catch (e) { return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300), rawSample }, { status: 502 }); }

  // ---- Insert: bỏ qua SKU đã có ----
  const existing = await db.select({ sku: schema.skuMappings.internalSku }).from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
  const have = new Set(existing.map((x) => x.sku));
  let created = 0, skipped = 0;
  const seen = new Set<string>();
  for (const it of rows) {
    const sku = it.sku || it.variantId; // fallback: dùng variant_id làm SKU nếu catalog không có item_sku
    if (!sku || have.has(sku) || seen.has(sku)) { skipped++; continue; }
    seen.add(sku);
    try {
      await db.insert(schema.skuMappings).values({
        internalSku: sku, fulfillerId: ff.id, fulfillerSku: sku,
        productType: it.product?.slice(0, 120) || null,
        fulfillerProduct: it.product?.slice(0, 200) || null,
        variant: it.variant?.slice(0, 120) || null,
        fulfillerProductId: it.variantId || null,
        baseCost: it.cost.toFixed(2), shipCost: it.ship.toFixed(2),
      });
      created++;
    } catch { skipped++; }
  }

  return NextResponse.json({ ok: true, found: rows.length, created, skipped, rawSample });
}
