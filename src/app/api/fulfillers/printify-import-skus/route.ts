import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listPrintifyProducts } from "@/lib/printify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId } — kéo toàn bộ product/variant từ Printify về, tự tạo SKU mapping.
 * internal_sku = fulfiller_sku = SKU variant Printify (mặc định trùng — sửa sau nếu cần).
 * base_cost = cost variant (cent → $). ship_cost để 0 (Printify tính ship theo đơn).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "thiếu fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller không tồn tại" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; apiToken?: string; shopId?: string };
  const token = c.apiKey || c.apiToken;
  if (!token || !c.shopId) return NextResponse.json({ ok: false, error: "Chưa cấu hình token + Shop ID cho Printify" }, { status: 400 });

  let products;
  try { products = await listPrintifyProducts(token, c.shopId); }
  catch (e) { return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 502 }); }

  // Lấy các mapping đã có để bỏ qua trùng
  const existing = await db.select({ sku: schema.skuMappings.internalSku }).from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
  const have = new Set(existing.map((x) => x.sku));

  let created = 0, skipped = 0, noSku = 0;
  const seen = new Set<string>();
  for (const p of products) {
    for (const v of p.variants ?? []) {
      if (!v.is_enabled) continue;
      const sku = String(v.sku ?? "").trim();
      if (!sku) { noSku++; continue; }
      if (have.has(sku) || seen.has(sku)) { skipped++; continue; }
      seen.add(sku);
      try {
        await db.insert(schema.skuMappings).values({
          internalSku: sku, fulfillerId: ff.id, fulfillerSku: sku,
          fulfillerProduct: p.title?.slice(0, 200) ?? null,
          variant: v.title?.slice(0, 200) ?? null,
          baseCost: (Number(v.cost ?? 0) / 100).toFixed(2),
          shipCost: "0",
        });
        created++;
      } catch { skipped++; }
    }
  }

  return NextResponse.json({ ok: true, products: products.length, created, skipped, noSku });
}
