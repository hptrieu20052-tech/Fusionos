import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getWembroideryCatalog } from "@/lib/wembroidery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId } — kéo catalog Wembroidery (GET /public/catalog) → tạo SKU mapping.
 * Wembroidery KHÔNG có SKU per-variant → tự dựng: WEM-{catalogId}-{COLOR}-{SIZE}.
 * fulfiller_product_id = catalogId (push cần), variant = "Color / Size" (adapter tách lại khi đẩy đơn).
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
  if (!apiKey) return NextResponse.json({ ok: false, error: "Wembroidery token not configured (Settings → API Key: paste store token from seller.wembroidery.com)" }, { status: 400 });

  let rows, sample: unknown;
  try {
    const r = await getWembroideryCatalog({ apiKey, endpoint: ff.apiEndpoint });
    rows = r.rows; sample = r.sample;
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }

  const existing = await db.select({ sku: schema.skuMappings.internalSku }).from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
  const have = new Set(existing.map((x) => x.sku));

  const slug = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  let created = 0, skipped = 0;
  const seen = new Set<string>();
  for (const it of rows) {
    const sku = ["WEM", it.catalogId, slug(it.color) || null, slug(it.size) || null].filter(Boolean).join("-");
    if (!sku || have.has(sku) || seen.has(sku)) { skipped++; continue; }
    seen.add(sku);
    try {
      await db.insert(schema.skuMappings).values({
        internalSku: sku, fulfillerId: ff.id, fulfillerSku: sku,
        productType: it.product?.slice(0, 120) || null,
        fulfillerProduct: it.product?.slice(0, 200) || null,
        variant: [it.color, it.size].filter(Boolean).join(" / ").slice(0, 120) || null,
        fulfillerProductId: it.catalogId,
        baseCost: (it.cost || 0).toFixed(2), shipCost: (it.ship || 0).toFixed(2),
      });
      created++;
    } catch { skipped++; }
  }

  return NextResponse.json({ ok: true, found: rows.length, created, skipped, done: true, rawSample: sample });
}
