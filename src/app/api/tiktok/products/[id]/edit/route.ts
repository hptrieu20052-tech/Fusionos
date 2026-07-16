import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { ttGetProductDetail, ttEditProduct } from "@/lib/tiktok-shop";
import { resolveProduct, buildProductBody, type ProductOverrides } from "@/lib/tiktok-products";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/tiktok/products/[id]/edit — sửa product LIVE trên TikTok (Edit Product 202309, full-replace body).
// body: { title?, description?, saveMode?, skus?, dryRun? }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const r = await resolveProduct(session, params.id);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });

  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const overrides: ProductOverrides = {
    title: typeof b.title === "string" ? b.title : undefined,
    description: typeof b.description === "string" ? b.description : undefined,
    saveMode: b.saveMode === "AS_DRAFT" ? "AS_DRAFT" : "LISTING", // edit mặc định giữ ĐANG BÁN
    skus: Array.isArray(b.skus) ? (b.skus as Record<string, unknown>[]).map((s) => ({
      price: s.price != null ? String(s.price) : undefined,
      quantity: s.quantity != null ? Number(s.quantity) : undefined,
      sellerSku: typeof s.sellerSku === "string" ? s.sellerSku : undefined,
    })) : undefined,
    packageWeightGram: b.packageWeightGram != null && b.packageWeightGram !== "" ? String(b.packageWeightGram) : undefined,
    packageDim: b.packageDim && typeof b.packageDim === "object" ? {
      length: (b.packageDim as Record<string, unknown>).length != null ? String((b.packageDim as Record<string, unknown>).length) : undefined,
      width: (b.packageDim as Record<string, unknown>).width != null ? String((b.packageDim as Record<string, unknown>).width) : undefined,
      height: (b.packageDim as Record<string, unknown>).height != null ? String((b.packageDim as Record<string, unknown>).height) : undefined,
    } : undefined,
  };

  try {
    const detail = await ttGetProductDetail(r.cfg, r.row.tiktokProductId);
    const body = buildProductBody(detail, overrides);
    if (b.dryRun) return NextResponse.json({ ok: true, dryRun: true, body });

    await ttEditProduct(r.cfg, r.row.tiktokProductId, body);

    // Cập nhật local để phản hồi ngay (không đợi Sync). Giá lấy min các sku override/nguồn.
    const firstPrice = overrides.skus?.map((s) => Number(s.price)).filter((n) => !isNaN(n) && n > 0);
    const patch: Record<string, unknown> = { syncedAt: sql`now()` };
    if (overrides.title) patch.title = overrides.title;
    if (firstPrice && firstPrice.length) patch.priceMin = String(Math.min(...firstPrice));
    await db.update(schema.tiktokProducts).set(patch).where(eq(schema.tiktokProducts.id, r.row.id));

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 });
  }
}
