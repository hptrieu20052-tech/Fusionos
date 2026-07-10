import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listPrintifyProducts } from "@/lib/printify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId } — liệt kê product Printify + variant (SKU, giá vốn) kèm trạng thái đã map.
 * Dùng cho bộ chọn: tick sản phẩm cần fulfill, bỏ tick sản phẩm không cần.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; apiToken?: string; shopId?: string };
  const token = c.apiKey || c.apiToken;
  if (!token || !c.shopId) return NextResponse.json({ ok: false, error: "Token + Shop ID not configured for Printify" }, { status: 400 });

  let products;
  try { products = await listPrintifyProducts(token, c.shopId); }
  catch (e) { return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 502 }); }

  const existing = await db.select({ sku: schema.skuMappings.fulfillerSku }).from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
  const mapped = new Set(existing.map((x) => x.sku));

  const out = products.map((p) => {
    const variants = (p.variants ?? []).filter((v) => v.is_enabled).map((v) => ({
      sku: String(v.sku ?? "").trim(), cost: Number(v.cost ?? 0) / 100, title: v.title,
      mapped: !!(v.sku && mapped.has(String(v.sku).trim())), hasSku: !!String(v.sku ?? "").trim(),
    }));
    const withSku = variants.filter((v) => v.hasSku);
    return {
      id: p.id, title: p.title,
      variants,
      total: withSku.length,
      mappedCount: withSku.filter((v) => v.mapped).length,
      noSku: variants.length - withSku.length,
    };
  });

  return NextResponse.json({ ok: true, products: out, shopId: String(c.shopId), rawCount: products.length });
}
