import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, desc, or, sql } from "drizzle-orm";
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
    const [r] = await db.select({
      p: schema.shopifyProducts, storeName: schema.stores.name, storeSeller: schema.stores.sellerId,
      videoCode: schema.productVideos.videoCode, videoTitle: schema.productVideos.title, videoThumbUrl: schema.productVideos.thumbUrl,
    })
      .from(schema.shopifyProducts)
      .leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
      .leftJoin(schema.productVideos, eq(schema.productVideos.id, schema.shopifyProducts.videoId))
      .where(eq(schema.shopifyProducts.id, id)).limit(1);
    if (!r) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    if (scopeIds && (!r.storeSeller || !scopeIds.includes(r.storeSeller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    return NextResponse.json({ ok: true, product: { ...r.p, storeName: r.storeName, videoCode: r.videoCode, videoTitle: r.videoTitle, videoThumbUrl: r.videoThumbUrl } });
  }

  const rows = await db.select({
    p: schema.shopifyProducts, storeName: schema.stores.name, sellerName: schema.users.fullName, storeSeller: schema.stores.sellerId,
    videoCode: schema.productVideos.videoCode, videoThumbUrl: schema.productVideos.thumbUrl,
  })
    .from(schema.shopifyProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .leftJoin(schema.users, eq(schema.users.id, schema.stores.sellerId))
    .leftJoin(schema.productVideos, eq(schema.productVideos.id, schema.shopifyProducts.videoId))
    .orderBy(desc(schema.shopifyProducts.updatedAt));

  const scoped = scopeIds ? rows.filter((r) => r.storeSeller && scopeIds.includes(r.storeSeller)) : rows;

  // v181 · Listing Etsy GỐC của từng sản phẩm (để nút "Etsy" nhảy về Manage Products · Etsy):
  //   - flow mới (v172): shopify_products.etsy_product_id
  //   - flow cũ: etsy_products.shopify_product_id = gid
  const linkEtsyIds = Array.from(new Set(scoped.map((r) => r.p.etsyProductId).filter(Boolean))) as string[];
  const linkGids = Array.from(new Set(scoped.map((r) => r.p.shopifyProductId).filter(Boolean))) as string[];
  const etsyRows = (linkEtsyIds.length || linkGids.length)
    ? await db.select({ id: schema.etsyProducts.id, gid: schema.etsyProducts.shopifyProductId, title: schema.etsyProducts.title, storeName: schema.stores.name, sellerName: schema.users.fullName })
        .from(schema.etsyProducts)
        .leftJoin(schema.stores, eq(schema.stores.id, schema.etsyProducts.storeId))
        .leftJoin(schema.users, eq(schema.users.id, schema.stores.sellerId))
        .where(or(
          linkEtsyIds.length ? inArray(schema.etsyProducts.id, linkEtsyIds) : sql`FALSE`,
          linkGids.length ? inArray(schema.etsyProducts.shopifyProductId, linkGids) : sql`FALSE`,
        ))
    : [];
  const etsyById = new Map(etsyRows.map((e) => [e.id, e]));
  const etsyByGid = new Map<string, typeof etsyRows[number]>();
  for (const e of etsyRows) { if (e.gid && !etsyByGid.has(e.gid)) etsyByGid.set(e.gid, e); }

  // v119: SẮP XẾP MỚI → CŨ. Trước đây orderBy updated_at: cột đó bị ghi lại mỗi lần AI Optimize,
  // feed copy, Save hay Push chạm vào sản phẩm, nên chạy AI vài con là cả bảng đảo thứ tự —
  // đúng cái "lộn xộn" đang thấy. Product ID của Shopify tăng dần theo thời gian tạo ⇒ ID lớn = mới hơn.
  const pidNum = (gid: string | null) => { const m = String(gid ?? "").match(/(\d+)\s*$/); return m ? Number(m[1]) : 0; };
  // v172: bản NHÁP stage từ Etsy (chưa có Shopify ID) lên ĐẦU bảng — đó là những con đang cần
  // hoàn thiện để Push, không được để chìm xuống trang cuối vì pid = 0.
  const draftFirst = (gid: string | null) => (gid ? 0 : 1);
  scoped.sort((a, b) =>
    (draftFirst(b.p.shopifyProductId) - draftFirst(a.p.shopifyProductId)) ||
    (pidNum(b.p.shopifyProductId) - pidNum(a.p.shopifyProductId)) ||
    (new Date(b.p.createdAt ?? 0).getTime() - new Date(a.p.createdAt ?? 0).getTime()));

  // Template FUSION của từng listing: gán tay (templateId) > tự khớp theo Product type (cùng store).
  const tpls = await db.select({ id: schema.shopifyTemplates.id, storeId: schema.shopifyTemplates.storeId, name: schema.shopifyTemplates.name, productType: schema.shopifyTemplates.productType, status: schema.shopifyTemplates.status, baseDescription: schema.shopifyTemplates.baseDescription, productDetails: schema.shopifyTemplates.productDetails, shippingInfo: schema.shopifyTemplates.shippingInfo, personalization: schema.shopifyTemplates.personalization }).from(schema.shopifyTemplates);
  const byId = new Map(tpls.map((t) => [t.id, t]));
  const matchTpl = (storeId: string, productType: string | null) => {
    const list = tpls.filter((t) => t.storeId === storeId);
    const pt = (productType ?? "").trim().toLowerCase();
    if (pt) { const m = list.find((t) => (t.productType ?? "").trim().toLowerCase() === pt); if (m) return m; }
    const active = list.filter((t) => t.status === "ACTIVE");
    if (active.length === 1) return active[0];
    if (list.length === 1) return list[0];
    return null;
  };

  const list = scoped.map((r) => {
    const vs = (Array.isArray(r.p.variants) ? r.p.variants as Variant[] : []);
    const prices = vs.map((v) => Number(v.price)).filter((n) => !isNaN(n) && n > 0);
    const imgs = (Array.isArray(r.p.images) ? r.p.images as Img[] : []);
    const pinned = r.p.templateId ? byId.get(r.p.templateId) ?? null : null;
    const tpl = pinned ?? matchTpl(r.p.storeId, r.p.productType);
    const tplHasFacts = !!(tpl && ((tpl.baseDescription ?? "").trim() || (tpl.productDetails ?? "").trim() || (tpl.shippingInfo ?? "").trim()));
    return {
      id: r.p.id, storeId: r.p.storeId, storeName: r.storeName, sellerName: r.sellerName,
      title: r.p.title, handle: r.p.handle, status: r.p.status, dirty: r.p.dirty,
      productType: r.p.productType ?? "",
      categoryName: (r.p.category as { name?: string } | null)?.name ?? "",
      collectionTitles: (Array.isArray(r.p.collections) ? r.p.collections as { title: string }[] : []).map((c) => c.title).filter(Boolean),
      variantCount: vs.length, minPrice: prices.length ? Math.min(...prices) : null, maxPrice: prices.length ? Math.max(...prices) : null,
      mainImage: imgs[0]?.src ?? null, imageCount: imgs.length,
      // v224 · video đã gắn: thumbnail để nhận biết listing nào có video (cột Video cạnh Image).
      videoCode: r.videoCode ?? null, videoThumbUrl: r.videoThumbUrl ?? null, videoPushed: !!r.p.videoPushedAt,
      onlineStoreUrl: r.p.onlineStoreUrl, totalInventory: r.p.totalInventory,
      templateId: tpl?.id ?? null, templateName: tpl?.name ?? "", templatePinned: !!pinned, templateHasFacts: tplHasFacts,
      syncedAt: r.p.syncedAt, pushedAt: r.p.pushedAt, aiAt: r.p.aiAt,
      // v177 · Policy scan: risk + tóm tắt hit (chỉ chuỗi ngắn, không chở nguyên mảng cho nhẹ bảng).
      policyRisk: r.p.policyRisk ?? null,
      policyCheckedAt: r.p.policyCheckedAt,
      // v181 · Listing Etsy gốc (null = không có / đã xoá bên Manage Etsy)
      etsyListing: (() => {
        const e = (r.p.etsyProductId ? etsyById.get(r.p.etsyProductId) : undefined)
          ?? (r.p.shopifyProductId ? etsyByGid.get(r.p.shopifyProductId) : undefined);
        return e ? { id: e.id, title: e.title, store: e.storeName ?? "", seller: e.sellerName ?? "" } : null;
      })(),
      policyHitsSummary: Array.isArray(r.p.policyHits)
        ? (r.p.policyHits as { term: string; field: string }[]).slice(0, 6).map((h) => `"${h.term}" (${h.field})`).join(", ")
        : "",
      // v191 · trả CẢ mảng hit (term/field/severity/fix) — click chip risk mở khung xem đầy đủ,
      // không phải đọc tooltip cụt. Đa số dòng là []/null nên payload không đáng kể.
      policyHits: Array.isArray(r.p.policyHits) ? r.p.policyHits : [],
      // v119: feed Merchant Center. Chỉ trả ĐỘ DÀI, không trả nguyên văn — 134 dòng × 1300 ký tự
      // là ~180KB thừa mỗi lần load bảng. Nội dung đầy đủ lấy ở GET ?id= khi mở Edit.
      feedAt: r.p.feedAt, feedTitleLen: (r.p.feedTitle ?? "").length, feedDescLen: (r.p.feedDescription ?? "").length,
      // v127: cột PIPELINE — "listing này đã chạy những gì rồi". Chỉ trả 4 CON SỐ, không trả nội dung.
      // fill-sku và image-alt đều ghi ngược variants/images về DB local ngay sau khi Shopify nhận
      // (fill-sku/route.ts:156, image-alt/route.ts:138) ⇒ 4 số này là tình trạng THẬT trên Shopify,
      // không phải phỏng đoán, và không cần bấm Sync mới thấy.
      // v141: listing đã tự đặt Custom options chưa (mảng = rồi, null = còn ăn theo template).
      // Chỉ trả CỜ + SỐ field, không trả nội dung — bảng 135 dòng không cần chở theo cả bộ câu hỏi.
      persOwn: Array.isArray(r.p.personalization),
      persCount: Array.isArray(r.p.personalization)
        ? (r.p.personalization as unknown[]).length
        : (Array.isArray(tpl?.personalization) ? (tpl!.personalization as unknown[]).length : 0),
      skuTotal: vs.length, skuDone: vs.filter((v) => String(v?.sku ?? "").trim()).length,
      altTotal: imgs.length, altDone: imgs.filter((i) => String(i?.altText ?? "").trim()).length,
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
  if ("seoTitle" in b) patch.seoTitle = String(b.seoTitle ?? "").slice(0, 200);
  if ("seoDescription" in b) patch.seoDescription = String(b.seoDescription ?? "").slice(0, 320);
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
