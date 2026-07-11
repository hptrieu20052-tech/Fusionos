import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listFlashshipVariants } from "@/lib/flashship";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId } — kéo variant FlashShip (GET /orders/list-variant-sku) → UPSERT skuMappings.
 * fulfillerSku = variant_id (SỐ — bắt buộc khi tạo đơn), product = "SHIRT GILDAN G5000",
 * variant = "BLACK / S". API KHÔNG trả giá → base/ship = 0, sửa tay hoặc nhập theo bảng giá FlashShip.
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
  if (!accessToken) return NextResponse.json({ ok: false, error: "FlashShip API token not configured (Settings → API Key)" }, { status: 400 });

  let variants;
  try {
    variants = await listFlashshipVariants({ accessToken, endpoint: ff.apiEndpoint });
  } catch (e) { return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 502 }); }

  const existing = await db.select({
    id: schema.skuMappings.id, sku: schema.skuMappings.internalSku,
    variant: schema.skuMappings.variant, pid: schema.skuMappings.fulfillerProductId,
  }).from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
  const byKey = new Map(existing.map((x) => [x.sku, x]));

  let created = 0, updated = 0, skipped = 0;
  const seen = new Set<string>();
  for (const v of variants) {
    const sku = String(v.variant_id ?? "");
    if (!sku || seen.has(sku)) { skipped++; continue; }
    seen.add(sku);
    const product = [v.product_type, v.brand, v.style].filter(Boolean).join(" ");
    const variant = [v.color, v.size].filter(Boolean).join(" / ");
    const ex = byKey.get(sku);
    try {
      if (!ex) {
        await db.insert(schema.skuMappings).values({
          internalSku: sku, fulfillerId: ff.id, fulfillerSku: sku,
          productType: product.slice(0, 120) || null,
          fulfillerProduct: product.slice(0, 200) || null,
          variant: variant.slice(0, 120) || null,
          fulfillerProductId: sku,
          baseCost: "0.00", shipCost: "0.00",
        });
        created++;
      } else {
        const patch: Record<string, unknown> = {};
        if (product) { patch.productType = product.slice(0, 120); patch.fulfillerProduct = product.slice(0, 200); }
        if (variant && variant !== ex.variant) patch.variant = variant.slice(0, 120);
        if (sku !== ex.pid) patch.fulfillerProductId = sku;
        if (Object.keys(patch).length) { await db.update(schema.skuMappings).set(patch).where(eq(schema.skuMappings.id, ex.id)); updated++; }
        else skipped++;
      }
    } catch { skipped++; }
  }
  return NextResponse.json({ ok: true, found: variants.length, created, updated, skipped, sample: variants[0] ?? null });
}
