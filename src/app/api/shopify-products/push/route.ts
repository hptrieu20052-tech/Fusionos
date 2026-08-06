import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopHost, shopifyGraphQL, type ShopifyCred } from "@/lib/shopify";
import { pushProductToShopify, fetchOneShopifyProduct, type SyncedVariant, type SyncedImage, type SyncedOption } from "@/lib/shopify-products";
import { payloadOf } from "@/lib/personalization";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
async function createOnShopify(cred: ShopifyCred, p: Row): Promise<{ gid?: string; error?: string }> {
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
    ...(productOptions.length ? { productOptions } : {}),
    variants,
    ...(files.length ? { files } : {}),
  };
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
  let fresh: Awaited<ReturnType<typeof fetchOneShopifyProduct>> = null;
  try { fresh = await fetchOneShopifyProduct(cred, gid); } catch { /* refetch lỗi không chặn — Shopify đã nhận */ }
  await db.update(schema.shopifyProducts).set({
    ...(fresh ? {
      handle: fresh.handle, title: fresh.title, bodyHtml: fresh.bodyHtml, vendor: fresh.vendor, productType: fresh.productType,
      tags: fresh.tags, status: fresh.status, seoTitle: fresh.seoTitle, seoDescription: fresh.seoDescription,
      category: fresh.category, collections: fresh.collections, options: fresh.options,
      variants: fresh.variants, images: fresh.images,
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

  const results: { id: string; title: string; ok: boolean; error?: string }[] = [];
  for (const r of rows) {
    const cred = (r.cred ?? {}) as ShopifyCred;
    if (r.mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
      results.push({ id: r.p.id, title: r.p.title, ok: false, error: "store chưa cấu hình Shopify API" }); continue;
    }
    try {
      // ---- v172 · Bản nháp stage từ Etsy: TẠO MỚI thay vì update ----
      if (!r.p.shopifyProductId) {
        const made = await createOnShopify(cred, r.p);
        if (!made.gid) { results.push({ id: r.p.id, title: r.p.title, ok: false, error: made.error ?? "create failed" }); continue; }
        await adoptCreated(cred, r.p, made.gid);
        results.push({ id: r.p.id, title: r.p.title, ok: true });
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
        const made = await createOnShopify(cred, r.p);
        if (!made.gid) { results.push({ id: r.p.id, title: r.p.title, ok: false, error: "old product was deleted on Shopify; re-create failed: " + (made.error ?? "") }); continue; }
        await adoptCreated(cred, { ...r.p, shopifyProductId: made.gid }, made.gid);
        results.push({ id: r.p.id, title: r.p.title, ok: true });
      } else results.push({ id: r.p.id, title: r.p.title, ok: false, error: res.error });
    } catch (e) {
      results.push({ id: r.p.id, title: r.p.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  const pushed = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: pushed > 0, pushed, failed: results.length - pushed, results });
}
