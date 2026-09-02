import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopbaseApi, shopbaseConfigured, type ShopBaseCred } from "@/lib/shopbase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Variant = { id?: string; title?: string; price?: string; compareAtPrice?: string | null; sku?: string; barcode?: string; inventoryQty?: number | null; selectedOptions?: { name: string; value: string }[] };
type Img = { id?: string; src?: string; altText?: string; position?: number };

/**
 * GET /api/shopbase-products            — danh sách sản phẩm ShopBase (kèm số đơn/listing).
 * GET /api/shopbase-products?id=<uuid>  — chi tiết 1 sản phẩm cho Card Detail modal.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const scopeIds = await storeOwnerScopeIds(session);
  const id = req.nextUrl.searchParams.get("id");

  // ── Chi tiết 1 sản phẩm ─────────────────────────────────────────────
  if (id) {
    const [row] = await db.select({
      p: schema.shopbaseProducts,
      sellerId: schema.stores.sellerId,
      storeName: schema.stores.name,
      marketplace: schema.stores.marketplace,
    }).from(schema.shopbaseProducts)
      .leftJoin(schema.stores, eq(schema.stores.id, schema.shopbaseProducts.storeId))
      .where(eq(schema.shopbaseProducts.id, id)).limit(1);
    if (!row || row.marketplace !== "shopbase") return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    if (scopeIds && !(row.sellerId && scopeIds.includes(row.sellerId))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    const p = row.p;
    return NextResponse.json({ ok: true, product: {
      id: p.id, shopbaseProductId: p.shopbaseProductId, handle: p.handle ?? "",
      title: p.title, bodyHtml: p.bodyHtml ?? "", vendor: p.vendor ?? "", productType: p.productType ?? "",
      tags: p.tags ?? "", status: p.status, seoTitle: p.seoTitle ?? "", seoDescription: p.seoDescription ?? "",
      onlineStoreUrl: p.onlineStoreUrl ?? null, storeName: row.storeName ?? "—",
      options: Array.isArray(p.options) ? p.options : [],
      variants: Array.isArray(p.variants) ? p.variants : [],
      images: Array.isArray(p.images) ? p.images : [],
    } });
  }

  // ── Danh sách ───────────────────────────────────────────────────────
  const rows = await db.select({
    p: schema.shopbaseProducts,
    storeName: schema.stores.name,
    sellerId: schema.stores.sellerId,
    sellerName: schema.users.fullName,
    marketplace: schema.stores.marketplace,
  }).from(schema.shopbaseProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopbaseProducts.storeId))
    .leftJoin(schema.users, eq(schema.users.id, schema.stores.sellerId))
    .where(eq(schema.stores.marketplace, "shopbase"))
    .orderBy(desc(schema.shopbaseProducts.updatedAt));

  const scoped = scopeIds ? rows.filter((r) => r.sellerId && scopeIds.includes(r.sellerId)) : rows;

  // Số ĐƠN theo listing: khớp phần SỐ của shopbase_product_id ↔ order_items.etsy_listing_id
  // (import ShopBase ghi etsy_listing_id = product_id). Loại đơn new/cancel/trash.
  const orderCountByPid = new Map<string, number>();
  try {
    const oc = (await db.execute(sql`
      SELECT regexp_replace(coalesce(oi.etsy_listing_id, ''), '[^0-9]', '', 'g') AS pid,
             count(DISTINCT oi.order_id)::int AS n
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status NOT IN ('new','cancel','trash')
      GROUP BY 1
    `)).rows as { pid: string; n: number }[];
    for (const r of oc) if (r.pid) orderCountByPid.set(r.pid, Number(r.n));
  } catch { /* để 0 */ }

  const out = scoped.map((r) => {
    const vars = (Array.isArray(r.p.variants) ? r.p.variants : []) as Variant[];
    const prices = vars.map((v) => Number(v.price)).filter((n) => n > 0);
    const imgs = (Array.isArray(r.p.images) ? r.p.images : []) as Img[];
    const thumb = imgs.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99)).map((i) => String(i?.src ?? ""))
      .find((s) => /^https?:\/\//i.test(s)) ?? null;
    const skuTotal = vars.length;
    const skuDone = vars.filter((v) => String(v.sku ?? "").trim()).length;
    const digits = String(r.p.shopbaseProductId ?? "").replace(/\D/g, "");
    return {
      id: r.p.id, storeId: r.p.storeId, storeName: r.storeName ?? "—",
      sellerId: r.sellerId ?? null, sellerName: r.sellerName ?? "—",
      shopbaseProductId: r.p.shopbaseProductId, handle: r.p.handle ?? "",
      title: r.p.title, productType: r.p.productType ?? "", tags: r.p.tags ?? "",
      status: r.p.status, collections: r.p.collections ?? [],
      onlineStoreUrl: r.p.onlineStoreUrl ?? null, totalInventory: r.p.totalInventory ?? null,
      dirty: r.p.dirty, variantCount: vars.length, imageCount: imgs.length,
      priceMin: prices.length ? Math.min(...prices) : null,
      priceMax: prices.length ? Math.max(...prices) : null,
      skuDone, skuTotal, thumb,
      orders: digits ? (orderCountByPid.get(digits) ?? 0) : 0,
      syncedAt: r.p.syncedAt, updatedAt: r.p.updatedAt,
    };
  });

  return NextResponse.json({ ok: true, rows: out });
}

/**
 * PATCH /api/shopbase-products — lưu local + ĐẨY thẳng lên ShopBase (PUT products/{id}.json).
 * body: { id, title, bodyHtml, vendor, productType, tags, status, variants[], images[] }
 * Nếu store chưa cấu hình API → chỉ lưu local (dirty=true), trả về warn.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "");
  if (!id) return NextResponse.json({ ok: false, error: "thiếu id" }, { status: 400 });

  const [row] = await db.select({
    p: schema.shopbaseProducts,
    sellerId: schema.stores.sellerId,
    marketplace: schema.stores.marketplace,
    cred: schema.stores.apiCredentials,
  }).from(schema.shopbaseProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopbaseProducts.storeId))
    .where(eq(schema.shopbaseProducts.id, id)).limit(1);
  if (!row || row.marketplace !== "shopbase") return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && !(row.sellerId && scopeIds.includes(row.sellerId))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // Chuẩn hoá field từ client (giữ nguyên field không gửi).
  const title = typeof b.title === "string" ? b.title : row.p.title;
  const bodyHtml = typeof b.bodyHtml === "string" ? b.bodyHtml : (row.p.bodyHtml ?? "");
  const vendor = typeof b.vendor === "string" ? b.vendor : (row.p.vendor ?? "");
  const productType = typeof b.productType === "string" ? b.productType : (row.p.productType ?? "");
  const tags = typeof b.tags === "string" ? b.tags : (row.p.tags ?? "");
  const status = ["ACTIVE", "DRAFT", "ARCHIVED"].includes(b.status) ? b.status : row.p.status;

  const curVars = (Array.isArray(row.p.variants) ? row.p.variants : []) as Variant[];
  const inVars = (Array.isArray(b.variants) ? b.variants : []) as Variant[];
  // Ghép patch giá/sku theo id variant; giữ các field khác.
  const mergedVars: Variant[] = curVars.map((cv) => {
    const patch = inVars.find((iv) => String(iv.id ?? "") === String(cv.id ?? ""));
    return patch ? { ...cv, price: patch.price ?? cv.price, compareAtPrice: patch.compareAtPrice ?? cv.compareAtPrice, sku: patch.sku ?? cv.sku } : cv;
  });

  const inImgs = (Array.isArray(b.images) ? b.images : null) as Img[] | null;
  const mergedImgs: Img[] = (inImgs ?? (Array.isArray(row.p.images) ? row.p.images : []) as Img[])
    .map((im, i) => ({ id: im.id, src: im.src, altText: im.altText ?? "", position: i + 1 }));

  const cred = (((row.cred ?? {}) as Record<string, unknown>).shopbase ?? null) as ShopBaseCred | null;

  // Chưa cấu hình API → chỉ lưu local, đánh dấu dirty.
  if (!shopbaseConfigured(cred)) {
    await db.update(schema.shopbaseProducts).set({
      title, bodyHtml, vendor, productType, tags, status, variants: mergedVars, images: mergedImgs, dirty: true, updatedAt: new Date(),
    }).where(eq(schema.shopbaseProducts.id, id));
    return NextResponse.json({ ok: true, warn: "store chưa cấu hình API — đã lưu local, CHƯA đẩy lên ShopBase" });
  }

  // Đẩy lên ShopBase (REST mirror Shopify).
  const pidNum = Number(row.p.shopbaseProductId);
  const pid = Number.isFinite(pidNum) && String(pidNum) === row.p.shopbaseProductId ? pidNum : row.p.shopbaseProductId;
  const product: Record<string, unknown> = {
    id: pid, title, body_html: bodyHtml, vendor, product_type: productType, tags,
    published: status === "ACTIVE",
    variants: mergedVars.filter((v) => v.id).map((v) => ({
      id: Number(v.id) || v.id, price: v.price, compare_at_price: v.compareAtPrice || null, sku: v.sku,
    })),
    images: mergedImgs.filter((im) => im.src).map((im) => (
      im.id ? { id: Number(im.id) || im.id, position: im.position } : { src: im.src, position: im.position }
    )),
  };

  try {
    const resp = await shopbaseApi(cred!, `products/${row.p.shopbaseProductId}.json`, { method: "PUT", body: JSON.stringify({ product }) });
    // Lấy lại data chuẩn từ ShopBase để đồng bộ id ảnh/variant mới.
    const rp = (resp?.product ?? null) as Record<string, unknown> | null;
    let finalVars = mergedVars, finalImgs = mergedImgs;
    if (rp) {
      if (Array.isArray(rp.variants)) finalVars = (rp.variants as Record<string, unknown>[]).map((v) => ({
        id: String(v.id ?? ""), title: String(v.title ?? ""), price: String(v.price ?? ""),
        compareAtPrice: v.compare_at_price != null ? String(v.compare_at_price) : null, sku: String(v.sku ?? ""),
        barcode: String(v.barcode ?? ""), inventoryQty: typeof v.inventory_quantity === "number" ? v.inventory_quantity : null,
        selectedOptions: [],
      }));
      if (Array.isArray(rp.images)) finalImgs = (rp.images as Record<string, unknown>[]).map((im, i) => ({
        id: String(im.id ?? ""), src: String(im.src ?? ""), altText: String(im.alt ?? ""), position: typeof im.position === "number" ? im.position : i + 1,
      }));
    }
    await db.update(schema.shopbaseProducts).set({
      title, bodyHtml, vendor, productType, tags, status, variants: finalVars, images: finalImgs,
      dirty: false, pushedAt: new Date(), updatedAt: new Date(),
    }).where(eq(schema.shopbaseProducts.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Push lỗi → vẫn lưu local (dirty) để không mất chỉnh sửa.
    await db.update(schema.shopbaseProducts).set({
      title, bodyHtml, vendor, productType, tags, status, variants: mergedVars, images: mergedImgs, dirty: true, updatedAt: new Date(),
    }).where(eq(schema.shopbaseProducts.id, id));
    const err = String((e as Error)?.message ?? e).slice(0, 200);
    return NextResponse.json({ ok: false, error: "Đã lưu local nhưng ShopBase update lỗi: " + err });
  }
}
