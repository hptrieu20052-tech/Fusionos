import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

type Variant = { id: string; price: string; compareAtPrice: string | null; sku: string; selectedOptions: { name: string; value: string }[]; inventoryQty: number | null; barcode?: string; title?: string; inventoryItemId?: string | null };
type Img = { id: string; src: string; altText: string; position: number };

// GET /api/shopify-products            → danh sách (tóm tắt)
// GET /api/shopify-products?id=<uuid>  → chi tiết 1 sản phẩm (full)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const scopeIds = await storeOwnerScopeIds(session);
  const id = req.nextUrl.searchParams.get("id");

  if (id) {
    const [r] = await db.select({ p: schema.shopifyProducts, storeName: schema.stores.name, storeSeller: schema.stores.sellerId })
      .from(schema.shopifyProducts)
      .leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
      .where(eq(schema.shopifyProducts.id, id)).limit(1);
    if (!r) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    if (scopeIds && (!r.storeSeller || !scopeIds.includes(r.storeSeller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    return NextResponse.json({ ok: true, product: { ...r.p, storeName: r.storeName } });
  }

  const rows = await db.select({ p: schema.shopifyProducts, storeName: schema.stores.name, sellerName: schema.users.fullName, storeSeller: schema.stores.sellerId })
    .from(schema.shopifyProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .leftJoin(schema.users, eq(schema.users.id, schema.stores.sellerId))
    .orderBy(desc(schema.shopifyProducts.updatedAt));

  const scoped = scopeIds ? rows.filter((r) => r.storeSeller && scopeIds.includes(r.storeSeller)) : rows;
  const list = scoped.map((r) => {
    const vs = (Array.isArray(r.p.variants) ? r.p.variants as Variant[] : []);
    const prices = vs.map((v) => Number(v.price)).filter((n) => !isNaN(n) && n > 0);
    const imgs = (Array.isArray(r.p.images) ? r.p.images as Img[] : []);
    return {
      id: r.p.id, storeId: r.p.storeId, storeName: r.storeName, sellerName: r.sellerName,
      title: r.p.title, handle: r.p.handle, status: r.p.status, dirty: r.p.dirty,
      variantCount: vs.length, minPrice: prices.length ? Math.min(...prices) : null, maxPrice: prices.length ? Math.max(...prices) : null,
      mainImage: imgs[0]?.src ?? null, imageCount: imgs.length,
      onlineStoreUrl: r.p.onlineStoreUrl, totalInventory: r.p.totalInventory,
      syncedAt: r.p.syncedAt, pushedAt: r.p.pushedAt,
      optionsSummary: (Array.isArray(r.p.options) ? r.p.options as { name: string; values: string[] }[] : []).map((o) => `${o.name}: ${o.values.length}`).join(" · "),
    };
  });
  return NextResponse.json({ ok: true, rows: list });
}

// PATCH /api/shopify-products { id, title?, bodyHtml?, tags?, status?, vendor?, productType?, variants?, images? }
// Sửa LOCAL + đánh dấu dirty (chưa Push). Không đụng Shopify tới khi bấm Push.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const [r] = await db.select({ storeSeller: schema.stores.sellerId })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(eq(schema.shopifyProducts.id, id)).limit(1);
  if (!r) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!r.storeSeller || !scopeIds.includes(r.storeSeller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const patch: Record<string, unknown> = { dirty: true, updatedAt: new Date() };
  if (typeof b.title === "string" && b.title.trim()) patch.title = b.title.trim();
  if ("bodyHtml" in b) patch.bodyHtml = String(b.bodyHtml ?? "");
  if ("tags" in b) patch.tags = String(b.tags ?? "");
  if ("vendor" in b) patch.vendor = String(b.vendor ?? "");
  if ("productType" in b) patch.productType = String(b.productType ?? "");
  if (typeof b.status === "string" && ["ACTIVE", "DRAFT", "ARCHIVED"].includes(b.status.toUpperCase())) patch.status = b.status.toUpperCase();
  if (Array.isArray(b.variants)) patch.variants = b.variants;
  if (Array.isArray(b.images)) patch.images = b.images;

  await db.update(schema.shopifyProducts).set(patch).where(eq(schema.shopifyProducts.id, id));
  return NextResponse.json({ ok: true });
}

// DELETE /api/shopify-products { ids } — chỉ xóa bản ghi LOCAL trong FUSION (KHÔNG xóa trên Shopify).
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x)));
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds) {
    const rows = await db.select({ id: schema.shopifyProducts.id, seller: schema.stores.sellerId })
      .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
      .where(inArray(schema.shopifyProducts.id, ids));
    if (rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  await db.delete(schema.shopifyProducts).where(inArray(schema.shopifyProducts.id, ids));
  return NextResponse.json({ ok: true, deleted: ids.length });
}
