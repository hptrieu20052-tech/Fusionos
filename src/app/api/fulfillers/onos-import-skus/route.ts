import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listOnosProducts } from "@/lib/onos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId } — kéo catalog ONOS (GET /products, phân trang) → tạo SKU mapping.
 * fulfiller_sku = SKU variant ONOS, fulfiller_product_id = product id, variant = "Color / Size".
 * Trả kèm rawSample để soi cấu trúc nếu parse chưa khớp.
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
  type Row = { sku: string; productType: string; variant: string; cost: number; productId?: string };
  const rows: Row[] = [];
  let sample: unknown = null;
  let done = false;
  try {
    for (let page = 1; page <= 40; page++) {
      if (Date.now() - start > 40000) break; // giữ ngân sách thời gian cho phần insert
      const r = await listOnosProducts(cred, page, 100);
      if (!sample) sample = r.sample;
      for (const v of r.variants) rows.push({ sku: v.sku, productType: v.product, variant: v.variant, cost: v.price ?? 0, productId: v.productId });
      if (!r.hasMore) { done = true; break; }
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }

  // Bỏ qua SKU đã có (kéo tăng dần)
  const existing = await db.select({ sku: schema.skuMappings.internalSku }).from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
  const have = new Set(existing.map((x) => x.sku));

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
        baseCost: it.cost.toFixed(2), shipCost: "0",
      });
      created++;
    } catch { skipped++; }
  }

  return NextResponse.json({ ok: true, found: rows.length, created, skipped, done, rawSample: sample });
}
