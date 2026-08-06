import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopHost, shopifyGraphQL, type ShopifyCred } from "@/lib/shopify";
import { pushProductToShopify, fetchOneShopifyProduct, type SyncedVariant, type SyncedImage, type SyncedOption } from "@/lib/shopify-products";
import { payloadOf } from "@/lib/personalization";
import { collectionAddProducts, publishToPublications } from "@/lib/shopify-bulk";
import type { Template } from "@/lib/shopify-template";

export const dynamic = "force-dynamic";
// v172b: 60 → 300. Tạo mới từ bản nháp (productSet synchronous + upload media + chờ media xử lý)
// chậm hơn update nhiều; 60s là bị Vercel cắt giữa lô 5 con.
export const maxDuration = 300;

/**
 * POST /api/shopify-products/push { ids } — đẩy chỉnh sửa local lên Shopify.
 *   - Bản ghi ĐÃ có shopify_product_id → productUpdate + variants + media (như trước).
 *   - v172 · Bản NHÁP stage từ Etsy (shopify_product_id = '') → productSet TẠO MỚI trên Shopify
 *     (options/variants/giá/ảnh/SEO từ bản nháp), ghi lại GID + metafield fusion.options
 *     (Custom options của seller), và ghi ngược GID về listing Etsy gốc.
 * Thành công → dirty=false, pushedAt=now, nạp lại bản mới từ Shopify (lấy variant GID / media GID).
 */
const PRODUCT_SET = `mutation Create($input: ProductSetInput!) {
  productSet(synchronous: true, input: $input) {
    product { id handle }
    userErrors { field message }
  }
}`;
const MF_SET = `mutation SetPers($m: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $m) { userErrors { message } }
}`;

type Row = typeof schema.shopifyProducts.$inferSelect;

// v172 · Tạo sản phẩm MỚI trên Shopify từ bản nháp local. Trả về GID hoặc lỗi.
// v172b · tpl (nếu bản nháp có template): lấy thêm category + category metafields + theme template
// ngay trong productSet — structure/giá vẫn theo BẢN NHÁP (người dùng sửa gì giữ nấy), không theo template.
async function createOnShopify(cred: ShopifyCred, p: Row, tpl?: Template | null): Promise<{ gid?: string; error?: string }> {
  const opts = (Array.isArray(p.options) ? p.options as SyncedOption[] : []).filter((o) => o?.name && Array.isArray(o.values) && o.values.length);
  const productOptions = opts.map((o, i) => ({ name: o.name, position: i + 1, values: o.values.map((v) => ({ name: v })) }));
  const localVariants = (Array.isArray(p.variants) ? p.variants as SyncedVariant[] : []);
  const variants = (localVariants.length ? localVariants : [{ selectedOptions: [], price: "0", sku: "" } as unknown as SyncedVariant])
    .slice(0, 100)
    .map((v) => ({
      optionValues: (v.selectedOptions ?? []).map((so) => ({ optionName: so.name, name: so.value })),
      price: v.price || "0",
      ...(v.compareAtPrice != null && String(v.compareAtPrice).trim() !== "" ? { compareAtPrice: v.compareAtPrice } : {}),
      ...(v.sku ? { sku: v.sku } : {}),
      inventoryItem: { tracked: false },
    }));
  const files = (Array.isArray(p.images) ? p.images as SyncedImage[] : [])
    .filter((im) => /^https?:\/\//i.test(im?.src ?? ""))
    .map((im) => ({ originalSource: im.src, contentType: "IMAGE" }));

  const input: Record<string, unknown> = {
    title: p.title,
    descriptionHtml: p.bodyHtml ?? "",
    vendor: p.vendor ?? undefined,
    productType: p.productType ?? "Personalized",
    status: (p.status || "DRAFT").toUpperCase(),
    tags: (p.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 250),
    ...((p.seoTitle || p.seoDescription) ? { seo: { title: p.seoTitle ?? "", description: p.seoDescription ?? "" } } : {}),
    ...(tpl?.category?.id ? { category: tpl.category.id } : {}),
    ...(tpl?.themeTemplate ? { templateSuffix: tpl.themeTemplate } : {}),
    ...(productOptions.length ? { productOptions } : {}),
    variants,
    ...(files.length ? { files } : {}),
  };
  const catMfs = (tpl?.categoryMetafields ?? []).filter((m) => m.namespace && m.key && m.type && String(m.value ?? "").trim() !== "");
  if (catMfs.length) input.metafields = catMfs.map((m) => ({ namespace: m.namespace, key: m.key, type: m.type, value: m.value }));
  const data = await shopifyGraphQL<{ productSet?: { product?: { id: string }; userErrors?: { message: string }[] } }>(cred, PRODUCT_SET, { input });
  const ue2 = data.productSet?.userErrors ?? [];
  if (ue2.length) return { error: ue2.map((e) => e.message).join("; ").slice(0, 200) };
  const gid = data.productSet?.product?.id;
  if (!gid) return { error: "productSet returned no product id" };

  // Custom options của seller → metafield fusion.options (snippet Liquid đọc để render ô nhập).
  const fields = payloadOf(p.personalization);
  if (fields.length) {
    await shopifyGraphQL(cred, MF_SET, {
      m: [{ ownerId: gid, namespace: "fusion", key: "options", type: "json", value: JSON.stringify(fields) }],
    }).catch(() => { /* metafield lỗi không chặn — Push personalization đẩy lại được */ });
  }
  return { gid };
}

// v172b · Collections + sales channels của template — áp sau khi có GID (giống applyTemplate lúc tạo mới).
// Lỗi phụ không chặn kết quả chính, gom lại báo "partial".
async function applyTplExtras(cred: ShopifyCred, tpl: Template, gid: string): Promise<string> {
  const warn: string[] = [];
  for (const cid of tpl.collectionIds ?? []) {
    try { await collectionAddProducts(cred, cid, [gid]); } catch (e) { warn.push("collection: " + String((e as Error)?.message ?? e).slice(0, 80)); }
  }
  if ((tpl.publicationIds ?? []).length) {
    try { await publishToPublications(cred, gid, tpl.publicationIds); } catch (e) { warn.push("channels: " + String((e as Error)?.message ?? e).slice(0, 80)); }
  }
  return warn.join("; ");
}

// v172 · Sau khi TẠO xong trên Shopify: nối GID vào bản ghi (NGAY — lỡ refetch lỗi cũng không tạo trùng
// lần Push sau), ghi ngược GID về listing Etsy gốc, rồi nạp lại bản mới (variant GID / media GID).
async function adoptCreated(cred: ShopifyCred, p: Row, gid: string) {
  await db.update(schema.shopifyProducts).set({ shopifyProductId: gid, updatedAt: new Date() }).where(eq(schema.shopifyProducts.id, p.id));
  if (p.etsyProductId) {
    try {
      await db.update(schema.etsyProducts).set({ shopifyProductId: gid, updatedAt: new Date() })
        .where(eq(schema.etsyProducts.id, p.etsyProductId));
    } catch { /* ghi ngược Etsy lỗi không chặn kết quả push */ }
  }
  // v172b · Media upload là BẤT ĐỒNG BỘ: đọc lại ngay sau productSet thường được 0 ảnh, lưu đè là
  // "mất ảnh" cho tới lần Sync sau. Chờ và đọc lại vài lần cho tới khi đủ số ảnh đã gửi.
  const expectedImages = (Array.isArray(p.images) ? p.images as SyncedImage[] : []).filter((im) => /^https?:\/\//i.test(im?.src ?? "")).length;
  let fresh: Awaited<ReturnType<typeof fetchOneShopifyProduct>> = null;
  for (let i = 0; i < 4; i++) {
    try { fresh = await fetchOneShopifyProduct(cred, gid); } catch { /* refetch lỗi không chặn — Shopify đã nhận */ }
    if ((fresh?.images.length ?? 0) >= expectedImages || i === 3) break;
    await new Promise((r) => setTimeout(r, 2500));
  }
  // Vẫn chưa đủ ảnh (Shopify xử lý chậm) → giữ ảnh của bản nháp cho hiển thị, Sync sau sẽ thay bằng
  // bản có media GID thật.
  const freshImages = fresh && fresh.images.length >= expectedImages
    ? fresh.images
    : (Array.isArray(p.images) ? p.images as SyncedImage[] : []);
  await db.update(schema.shopifyProducts).set({
    ...(fresh ? {
      handle: fresh.handle, title: fresh.title, bodyHtml: fresh.bodyHtml, vendor: fresh.vendor, productType: fresh.productType,
      tags: fresh.tags, status: fresh.status, seoTitle: fresh.seoTitle, seoDescription: fresh.seoDescription,
      category: fresh.category, collections: fresh.collections, options: fresh.options,
      variants: fresh.variants, images: freshImages,
      onlineStoreUrl: fresh.onlineStoreUrl, totalInventory: fresh.totalInventory, syncedAt: new Date(),
    } : {}),
    dirty: false, pushedAt: new Date(), updatedAt: new Date(),
  }).where(eq(schema.shopifyProducts.id, p.id));
}
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 50);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });

  const rows = await db.select({ p: schema.shopifyProducts, cred: schema.stores.apiCredentials, seller: schema.stores.sellerId, mk: schema.stores.marketplace })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // v172b · Template của các bản nháp — cần cho category / collections / sales channels lúc TẠO MỚI.
  const tplIds = Array.from(new Set(rows.map((r) => r.p.templateId).filter(Boolean))) as string[];
  const tplRows = tplIds.length ? await db.select().from(schema.shopifyTemplates).where(inArray(schema.shopifyTemplates.id, tplIds)) : [];
  const tplById = new Map(tplRows.map((t) => [t.id, t as unknown as Template]));

  const results: { id: string; title: string; ok: boolean; error?: string }[] = [];
  for (const r of rows) {
    const cred = (r.cred ?? {}) as ShopifyCred;
    if (r.mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
      results.push({ id: r.p.id, title: r.p.title, ok: false, error: "store chưa cấu hình Shopify API" }); continue;
    }
    try {
      // ---- v172 · Bản nháp stage từ Etsy: TẠO MỚI thay vì update ----
      if (!r.p.shopifyProductId) {
        const tpl = r.p.templateId ? tplById.get(r.p.templateId) ?? null : null;
        const made = await createOnShopify(cred, r.p, tpl);
        if (!made.gid) { results.push({ id: r.p.id, title: r.p.title, ok: false, error: made.error ?? "create failed" }); continue; }
        const warn = tpl ? await applyTplExtras(cred, tpl, made.gid) : "";
        await adoptCreated(cred, r.p, made.gid);
        results.push({ id: r.p.id, title: r.p.title, ok: true, ...(warn ? { error: "partial: " + warn } : {}) });
        continue;
      }

      const res = await pushProductToShopify(cred, {
        shopifyProductId: r.p.shopifyProductId, title: r.p.title, bodyHtml: r.p.bodyHtml, tags: r.p.tags,
        status: r.p.status, vendor: r.p.vendor, productType: r.p.productType,
        seoTitle: r.p.seoTitle, seoDescription: r.p.seoDescription,
        variants: (Array.isArray(r.p.variants) ? r.p.variants as SyncedVariant[] : []),
        images: (Array.isArray(r.p.images) ? r.p.images as SyncedImage[] : []),
      });
      if (res.ok) {
        // Đọc lại từ Shopify sau khi push. BẮT BUỘC: ảnh mới thêm chưa có media GID trong bản local,
        // nếu không nạp lại thì lần Push sau productCreateMedia sẽ thêm ảnh đó LẦN NỮA (ảnh trùng).
        // Đồng thời làm mới variant GID / handle / inventory / collections cho đúng bảng.
        let fresh: Awaited<ReturnType<typeof fetchOneShopifyProduct>> = null;
        try { fresh = await fetchOneShopifyProduct(cred, r.p.shopifyProductId); } catch { /* refetch lỗi không chặn — Shopify đã nhận */ }
        await db.update(schema.shopifyProducts).set({
          ...(fresh ? {
            handle: fresh.handle, title: fresh.title, bodyHtml: fresh.bodyHtml, vendor: fresh.vendor, productType: fresh.productType,
            tags: fresh.tags, status: fresh.status, seoTitle: fresh.seoTitle, seoDescription: fresh.seoDescription,
            category: fresh.category, collections: fresh.collections, options: fresh.options,
            variants: fresh.variants, images: fresh.images,
            onlineStoreUrl: fresh.onlineStoreUrl, totalInventory: fresh.totalInventory, syncedAt: new Date(),
          } : {}),
          dirty: false, pushedAt: new Date(), updatedAt: new Date(),
        }).where(eq(schema.shopifyProducts.id, r.p.id));
        results.push({ id: r.p.id, title: r.p.title, ok: true });
      } else if (/does not exist|doesn'?t exist|not found/i.test(res.error ?? "")) {
        // v172 · Sản phẩm đã bị XOÁ tay trên Shopify mà bản ghi vẫn giữ GID cũ → tự gỡ liên kết
        // và TẠO LẠI ngay trong lần Push này (nội dung lấy từ bản local đang có).
        const tpl = r.p.templateId ? tplById.get(r.p.templateId) ?? null : null;
        const made = await createOnShopify(cred, r.p, tpl);
        if (!made.gid) { results.push({ id: r.p.id, title: r.p.title, ok: false, error: "old product was deleted on Shopify; re-create failed: " + (made.error ?? "") }); continue; }
        const warn = tpl ? await applyTplExtras(cred, tpl, made.gid) : "";
        await adoptCreated(cred, { ...r.p, shopifyProductId: made.gid }, made.gid);
        results.push({ id: r.p.id, title: r.p.title, ok: true, ...(warn ? { error: "partial: " + warn } : {}) });
      } else results.push({ id: r.p.id, title: r.p.title, ok: false, error: res.error });
    } catch (e) {
      results.push({ id: r.p.id, title: r.p.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  const pushed = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: pushed > 0, pushed, failed: results.length - pushed, results });
}
