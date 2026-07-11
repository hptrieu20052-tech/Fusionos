import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listPrintifyProducts } from "@/lib/printify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId, selectedProductIds: string[] } — đồng bộ SKU mapping theo sản phẩm được chọn.
 * - Sản phẩm được tick  → thêm mapping cho các variant có SKU (bỏ qua đã có).
 * - Sản phẩm bỏ tick    → xóa mapping của các variant đó (CHỈ SKU do Printify tạo — không đụng mapping tay).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId || !Array.isArray(b.selectedProductIds)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; apiToken?: string; shopId?: string };
  const token = c.apiKey || c.apiToken;
  if (!token || !c.shopId) return NextResponse.json({ ok: false, error: "Token + Shop ID not configured" }, { status: 400 });

  let products;
  try { products = await listPrintifyProducts(token, c.shopId); }
  catch (e) { return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 }); }

  const selected = new Set<string>(b.selectedProductIds);
  // SKU mong muốn (từ sản phẩm được chọn) + toàn bộ SKU Printify (để biết cái nào do Printify tạo)
  const desired = new Map<string, { cost: number; title: string; product: string }>();
  const allPrintifySku = new Set<string>();
  for (const p of products) {
    for (const v of p.variants ?? []) {
      if (!v.is_enabled) continue;
      const sku = String(v.sku ?? "").trim();
      if (!sku) continue;
      allPrintifySku.add(sku);
      if (selected.has(p.id)) desired.set(sku, { cost: Number(v.cost ?? 0) / 100, title: v.title, product: p.title });
    }
  }

  const existing = await db.select().from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
  const existingSku = new Set(existing.map((m) => m.fulfillerSku));

  // THÊM: SKU mong muốn chưa có
  let added = 0;
  for (const [sku, info] of Array.from(desired.entries())) {
    if (existingSku.has(sku)) continue;
    try {
      await db.insert(schema.skuMappings).values({
        internalSku: sku, fulfillerId: ff.id, fulfillerSku: sku,
        fulfillerProduct: info.product?.slice(0, 200) ?? null, variant: info.title?.slice(0, 200) ?? null,
        baseCost: info.cost.toFixed(2), shipCost: "0",
      });
      added++;
    } catch { /* trùng internal_sku → bỏ qua */ }
  }

  // XÓA: mapping có SKU thuộc Printify nhưng KHÔNG nằm trong desired (sản phẩm bị bỏ tick)
  const toRemove = existing.filter((m) => allPrintifySku.has(m.fulfillerSku) && !desired.has(m.fulfillerSku)).map((m) => m.id);
  let removed = 0;
  if (toRemove.length) {
    await db.delete(schema.skuMappings).where(and(eq(schema.skuMappings.fulfillerId, ff.id), inArray(schema.skuMappings.id, toRemove)));
    removed = toRemove.length;
  }

  return NextResponse.json({ ok: true, added, removed, kept: desired.size - added });
}
