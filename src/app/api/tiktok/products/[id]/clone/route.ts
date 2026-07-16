import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { ttGetProductDetail, ttCreateProduct, ttGetWarehouses } from "@/lib/tiktok-shop";
import { resolveProduct, buildProductBody, type ProductOverrides } from "@/lib/tiktok-products";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/tiktok/products/[id]/clone — nhân bản CÙNG shop.
// body: { title?, description?, saveMode?: "LISTING"|"AS_DRAFT", skus?: [{price?,quantity?,sellerSku?}], dryRun? }
// dryRun=true → CHỈ trả body sẽ gửi (review), KHÔNG tạo trên TikTok.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const r = await resolveProduct(session, params.id);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });

  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const overrides: ProductOverrides = {
    title: typeof b.title === "string" ? b.title : undefined,
    description: typeof b.description === "string" ? b.description : undefined,
    saveMode: b.saveMode === "LISTING" ? "LISTING" : "AS_DRAFT", // clone mặc định NHÁP cho an toàn
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
    mainImageUris: Array.isArray(b.mainImageUris) ? (b.mainImageUris as unknown[]).filter((x): x is string => typeof x === "string") : undefined,
  };

  try {
    const detail = await ttGetProductDetail(r.cfg, r.row.tiktokProductId);
    // Warehouse fallback nếu source inventory không kèm warehouse_id
    let wh: string | undefined;
    const skus = (detail.skus as { inventory?: { warehouse_id?: string }[] }[] | undefined) ?? [];
    const hasWh = skus.some((s) => (s.inventory ?? []).some((i) => i.warehouse_id));
    if (!hasWh) { const whs = await ttGetWarehouses(r.cfg); wh = (whs.find((w) => w.isDefault) ?? whs[0])?.id; }

    const body = buildProductBody(detail, overrides, wh);
    if (b.dryRun) return NextResponse.json({ ok: true, dryRun: true, body });

    const { productId, raw } = await ttCreateProduct(r.cfg, body);
    return NextResponse.json({ ok: true, productId, warnings: (raw as { warnings?: unknown })?.warnings ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 });
  }
}
