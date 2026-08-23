import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * Manage Products AMAZON (v286) — bản stage riêng của từng listing, như flow Etsy → Shopify.
 *
 * GET    → danh sách (JOIN shopify_products lấy ảnh/SKU/type/nguồn)
 * POST   { ids } → "Push to Amazon": ids = shopify_products.id → tạo bản ghi DRAFT (bỏ qua con đã có)
 * PATCH  { id, title?, bullets?, description?, amazonTemplateId?, status?, asin? } → sửa nội dung Amazon
 * DELETE ?id= → gỡ khỏi Manage Products Amazon (không đụng Shopify)
 */

type Variant = { sku?: string | null; price?: string };
type Img = { src?: string; position?: number };

function rootSku(variants: unknown): string {
  const arr = (Array.isArray(variants) ? variants : []) as Variant[];
  for (const v of arr) {
    const s = String(v?.sku ?? "").trim();
    if (!s) continue;
    const parts = s.split("-").filter(Boolean);
    return parts.length >= 2 ? parts.slice(0, 2).join("-") : s;
  }
  return "";
}
function coverUrl(images: unknown): string {
  const arr = (Array.isArray(images) ? images : []) as Img[];
  const f = arr.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99)).find((i) => /^https:\/\//i.test(String(i?.src ?? "")));
  return f ? String(f.src) : "";
}
function imgCount(images: unknown): number {
  const arr = (Array.isArray(images) ? images : []) as Img[];
  return arr.filter((i) => /^https:\/\//i.test(String(i?.src ?? ""))).length;
}
// v297 · toàn bộ URL ảnh nguồn (sorted theo position) — modal Images dùng làm bộ khởi điểm.
function srcUrls(images: unknown): string[] {
  const arr = (Array.isArray(images) ? images : []) as Img[];
  return arr.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99))
    .map((i) => String(i?.src ?? "").trim()).filter((s) => /^https:\/\//i.test(s));
}
// Bộ ảnh override của bản ghi Amazon (string[]) — hợp lệ khi là mảng URL https.
function ovrUrls(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const arr = v.map((x) => String(x ?? "").trim()).filter((s) => /^https:\/\//i.test(s));
  return arr.length ? arr : null;
}
function variantCount(variants: unknown): number {
  return Array.isArray(variants) ? variants.length : 0;
}

export async function GET() {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const scopeIds = await storeOwnerScopeIds(session);

  const rows = await db.select({
    a: schema.amazonProducts,
    srcTitle: schema.shopifyProducts.title,
    srcType: schema.shopifyProducts.productType,
    srcStatus: schema.shopifyProducts.status,
    srcImages: schema.shopifyProducts.images,
    srcVariants: schema.shopifyProducts.variants,
    storeName: schema.stores.name,
    seller: schema.stores.sellerId,
  }).from(schema.amazonProducts)
    .leftJoin(schema.shopifyProducts, eq(schema.shopifyProducts.id, schema.amazonProducts.shopifyProductId))
    .leftJoin(schema.stores, eq(schema.stores.id, schema.amazonProducts.storeId));

  const scoped = scopeIds ? rows.filter((r) => r.seller && scopeIds.includes(r.seller)) : rows;
  scoped.sort((a, b) => new Date(b.a.createdAt ?? 0).getTime() - new Date(a.a.createdAt ?? 0).getTime());

  return NextResponse.json({
    ok: true,
    rows: scoped.map((r) => ({
      id: r.a.id,
      shopifyProductId: r.a.shopifyProductId,
      title: r.a.title, bullets: (r.a.bullets as string[] | null) ?? null, description: r.a.description,
      aiAt: r.a.aiAt, status: r.a.status, asin: r.a.asin, exportedAt: r.a.exportedAt,
      amazonTemplateId: r.a.amazonTemplateId,
      variations: (Array.isArray(r.a.variations) ? r.a.variations : null) as { suffix: string; label: string; price: string }[] | null,
      sourceTitle: r.srcTitle ?? "(source listing missing)",
      productType: (r.srcType ?? "").trim(),
      sourceStatus: r.srcStatus ?? "",
      // v297 · override ảnh riêng Amazon: cover + count ưu tiên bộ override
      image: (ovrUrls(r.a.images)?.[0]) ?? coverUrl(r.srcImages),
      imageCount: ovrUrls(r.a.images)?.length ?? imgCount(r.srcImages),
      images: ovrUrls(r.a.images),
      sourceImages: srcUrls(r.srcImages),
      srcVariantCount: variantCount(r.srcVariants),
      skuRoot: rootSku(r.srcVariants),
      storeName: r.storeName,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 500);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  // v297 · template chọn lúc Push (gán cứng cho các bản ghi mới). Rỗng = Auto theo Product type.
  const templateId = typeof b?.templateId === "string" && /^[0-9a-f-]{36}$/i.test(b.templateId) ? b.templateId : null;

  const src = await db.select({
    id: schema.shopifyProducts.id, storeId: schema.shopifyProducts.storeId, seller: schema.stores.sellerId,
  }).from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && src.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const existing = await db.select({ sid: schema.amazonProducts.shopifyProductId })
    .from(schema.amazonProducts).where(inArray(schema.amazonProducts.shopifyProductId, ids));
  const have = new Set(existing.map((e) => e.sid));

  const fresh = src.filter((r) => !have.has(r.id));
  if (fresh.length) {
    await db.insert(schema.amazonProducts).values(fresh.map((r) => ({ storeId: r.storeId, shopifyProductId: r.id, amazonTemplateId: templateId })));
  }
  return NextResponse.json({ ok: true, created: fresh.length, skipped: src.length - fresh.length });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const [row] = await db.select({ id: schema.amazonProducts.id, seller: schema.stores.sellerId })
    .from(schema.amazonProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.amazonProducts.storeId))
    .where(eq(schema.amazonProducts.id, id)).limit(1);
  if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!row.seller || !scopeIds.includes(row.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof b?.title === "string") set.title = b.title.trim().slice(0, 250) || null;
  if (typeof b?.description === "string") set.description = b.description.trim().slice(0, 2500) || null;
  if (Array.isArray(b?.bullets)) {
    const arr = b.bullets.map((x: unknown) => String(x ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, 5);
    set.bullets = arr.length ? arr : null;
  }
  if (typeof b?.amazonTemplateId === "string") set.amazonTemplateId = /^[0-9a-f-]{36}$/i.test(b.amazonTemplateId) ? b.amazonTemplateId : null;
  // v297 · bộ ảnh riêng Amazon: mảng URL https (≤12). Mảng rỗng = xoá override, quay về ảnh Shopify.
  if (Array.isArray(b?.images)) {
    const arr = b.images.map((x: unknown) => String(x ?? "").trim()).filter((s: string) => /^https:\/\//i.test(s)).slice(0, 12);
    set.images = arr.length ? arr : null;
  }
  if (typeof b?.status === "string" && ["DRAFT", "EXPORTED", "LIVE"].includes(b.status)) set.status = b.status;
  if (typeof b?.asin === "string") set.asin = b.asin.trim().slice(0, 20) || null;
  // v313 · override variations riêng listing ([{suffix,label,price}]). Mảng rỗng = xoá override (dùng template).
  if (Array.isArray(b?.variations)) {
    const arr = (b.variations as { suffix?: unknown; label?: unknown; price?: unknown }[])
      .map((v) => ({ suffix: String(v?.suffix ?? "").trim().slice(0, 40), label: String(v?.label ?? "").trim().slice(0, 60), price: String(v?.price ?? "").trim().slice(0, 12) }))
      .filter((v) => v.suffix);
    set.variations = arr.length ? arr : null;
  }

  await db.update(schema.amazonProducts).set(set).where(eq(schema.amazonProducts.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const [row] = await db.select({ id: schema.amazonProducts.id, seller: schema.stores.sellerId })
    .from(schema.amazonProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.amazonProducts.storeId))
    .where(eq(schema.amazonProducts.id, id)).limit(1);
  if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!row.seller || !scopeIds.includes(row.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  await db.delete(schema.amazonProducts).where(eq(schema.amazonProducts.id, id));
  return NextResponse.json({ ok: true });
}
