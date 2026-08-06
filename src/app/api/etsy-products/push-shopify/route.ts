import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopifyGraphQL, shopHost, type ShopifyCred } from "@/lib/shopify";
import { applyTemplate, type Template } from "@/lib/shopify-template";
import { payloadOf } from "@/lib/personalization";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/etsy-products/push-shopify { ids: string[], storeId: string }
 * Tạo THẲNG sản phẩm trên store Shopify qua GraphQL (productSet) — KHÔNG cần export/import CSV.
 * Map: title (shopifyTitle||title), mô tả, tags, options+variants từ variations, giá theo size
 * (variantPrices), ảnh Etsy CDN. Trạng thái = DRAFT để duyệt trước khi bán.
 * Chống đẩy trùng: lưu shopify_product_id vào etsy_products; nếu đã có thì cập nhật (productSet theo id).
 */
const MUT = `mutation Push($input: ProductSetInput!) {
  productSet(synchronous: true, input: $input) {
    product { id handle status }
    userErrors { field message }
  }
}`;

const CANON = /digital/i;

// v142 · Ghi bộ Custom options của listing Etsy lên metafield fusion.options của sản phẩm Shopify.
// Snippet Liquid fusion-personalization đọc đúng metafield này để render ô nhập ngoài storefront.
// Không có ô nào ⇒ bỏ qua, KHÔNG ghi mảng rỗng đè lên bộ đang chạy trên Shopify.
const MF_MUT = `mutation SetPers($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { userErrors { field message } }
}`;
async function pushPersonalization(cred: ShopifyCred, productGid: string, raw: unknown): Promise<string | null> {
  const fields = payloadOf(raw);
  if (!fields.length) return null;
  try {
    const d = await shopifyGraphQL<{ metafieldsSet?: { userErrors?: { message: string }[] } }>(cred, MF_MUT, {
      metafields: [{ ownerId: productGid, namespace: "fusion", key: "options", type: "json", value: JSON.stringify(fields) }],
    });
    const ue = d.metafieldsSet?.userErrors ?? [];
    return ue.length ? ue.map((e) => e.message).join("; ").slice(0, 160) : null;
  } catch (e) {
    return String((e as Error)?.message ?? e).slice(0, 160);
  }
}

// v171 · Bộ Custom options của listing Etsy cũng được LƯU vào shopify_products.personalization
// (bộ RIÊNG của listing) — để Manage Products · Shopify mở modal ra thấy đúng bộ của seller,
// và "Push personalization" theo template KHÔNG ghi đè nữa (bộ riêng luôn thắng, luật v141).
// Dòng shopify_products chưa tồn tại (store chưa Sync) thì bỏ qua — push-personalization (v171)
// đã biết tự tra ngược listing Etsy gốc theo shopify_product_id.
async function saveOwnFields(storeId: string, gid: string, raw: unknown) {
  const fields = payloadOf(raw);
  if (!fields.length) return;
  try {
    await db.update(schema.shopifyProducts)
      .set({ personalization: fields, updatedAt: new Date() })
      .where(and(eq(schema.shopifyProducts.storeId, storeId), eq(schema.shopifyProducts.shopifyProductId, gid)));
  } catch { /* lỗi lưu local không được chặn kết quả push */ }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 100);
  const storeId = String(b?.storeId ?? "").trim();
  const templateId = /^[0-9a-f-]{36}$/i.test(String(b?.templateId ?? "")) ? String(b.templateId) : "";
  if (!ids.length || !storeId) return NextResponse.json({ ok: false, error: "ids + storeId required" }, { status: 400 });

  // Store Shopify đích + credentials
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store || store.marketplace !== "shopify") return NextResponse.json({ ok: false, error: "target store is not Shopify" }, { status: 400 });
  const cred = (store.apiCredentials ?? {}) as ShopifyCred;
  if (!shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
    return NextResponse.json({ ok: false, error: "Shopify store chưa cấu hình API (Shop domain + Client ID/Secret)" }, { status: 400 });
  }

  // Scope: seller chỉ push từ listing của mình VÀ tới store của mình
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!store.sellerId || !scopeIds.includes(store.sellerId))) {
    return NextResponse.json({ ok: false, error: "forbidden: target store not in your scope" }, { status: 403 });
  }

  const rows = await db.select({ p: schema.etsyProducts, storeSeller: schema.stores.sellerId })
    .from(schema.etsyProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.etsyProducts.storeId))
    .where(inArray(schema.etsyProducts.id, ids));
  if (scopeIds && rows.some((r) => !r.storeSeller || !scopeIds.includes(r.storeSeller))) {
    return NextResponse.json({ ok: false, error: "forbidden: some listings are not in your stores" }, { status: 403 });
  }

  // Template (tuỳ chọn) — áp full preset (options/variants/giá/category/collection/kênh…) khi tạo trên Shopify.
  let tpl: Template | null = null;
  if (templateId) {
    const [t] = await db.select().from(schema.shopifyTemplates).where(eq(schema.shopifyTemplates.id, templateId)).limit(1);
    if (!t) return NextResponse.json({ ok: false, error: "template not found" }, { status: 404 });
    if (t.storeId !== storeId) return NextResponse.json({ ok: false, error: "template thuộc store khác — chọn template của đúng store đích" }, { status: 400 });
    tpl = t as unknown as Template;
  }

  const results: { id: string; title: string; ok: boolean; handle?: string; error?: string }[] = [];
  for (const { p } of rows) {
    try {
      // ---- Có template: dùng cấu trúc/giá từ template, nội dung (title/desc/ảnh) từ listing Etsy ----
      if (tpl) {
        const titleT = p.shopifyTitle || p.title;
        const descT = (p.shopifyDesc || p.description || "").replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
        const imgsT = (Array.isArray(p.images) ? p.images as string[] : []).filter(Boolean).slice(0, 12);
        const existingGidT = (p as { shopifyProductId?: string }).shopifyProductId || undefined;
        // Listing MỚI đẩy từ Etsy sang LUÔN là DRAFT — phải soát title/ảnh/giá rồi mới bật Active bằng tay.
        // Template có status ACTIVE thì trước đây nó lên sàn ngay lúc push. Đẩy LẠI (đã có gid) thì KHÔNG
        // đụng tới status: ghi đè DRAFT lên listing đang chạy là gỡ nó khỏi Google.
        const res = await applyTemplate(cred, tpl, { id: existingGidT, title: titleT, descriptionHtml: descT, images: imgsT }, { includeImages: true, statusOverride: existingGidT ? null : "DRAFT" });
        if (!res.ok || !res.productId) { results.push({ id: p.id, title: titleT, ok: false, error: res.error ?? "apply failed" }); continue; }
        await db.update(schema.etsyProducts).set({ shopifyProductId: res.productId, updatedAt: new Date() }).where(eq(schema.etsyProducts.id, p.id));
        const mfErrT = await pushPersonalization(cred, res.productId, (p as { personalization?: unknown }).personalization);
        await saveOwnFields(storeId, res.productId, (p as { personalization?: unknown }).personalization); // v171
        results.push({ id: p.id, title: titleT, ok: true, handle: res.handle, ...(mfErrT ? { error: "custom options not written: " + mfErrT } : {}) });
        continue;
      }
      const vars = (Array.isArray(p.variations) ? p.variations as { name?: string; values?: string[] }[] : [])
        .map((v) => ({ name: String(v.name ?? "").trim(), values: (v.values ?? []).map(String).filter((x) => x && !CANON.test(x)) }))
        .filter((v) => v.name && v.values.length)
        .slice(0, 3); // Shopify tối đa 3 option
      const vp = (p.variantPrices && typeof p.variantPrices === "object" ? p.variantPrices : {}) as Record<string, string>;
      const basePrice = String(p.price ?? "0");
      const priceFor = (vals: string[]) => {
        for (const v of vals) { const x = vp[v]; if (x != null && String(x).trim() !== "") return String(x); }
        return basePrice;
      };

      // Tổ hợp variant (v1 × v2 × v3), tối đa 100 (giới hạn Shopify)
      const combos: string[][] = vars.length
        ? vars.reduce<string[][]>((acc, v) => acc.flatMap((c) => v.values.map((val) => [...c, val])), [[]])
        : [[]];
      const cappedCombos = combos.slice(0, 100);

      const productOptions = vars.map((v, i) => ({ name: v.name, position: i + 1, values: v.values.map((val) => ({ name: val })) }));
      const variants = cappedCombos.map((vals) => ({
        optionValues: vars.map((v, i) => ({ optionName: v.name, name: vals[i] })),
        price: priceFor(vals),
        ...(p.sku ? { sku: p.sku } : {}),
        inventoryItem: { tracked: false },
      }));

      const images = (Array.isArray(p.images) ? p.images as string[] : []).filter(Boolean).slice(0, 12);
      const files = images.map((src) => ({ originalSource: src, contentType: "IMAGE" }));

      const title = p.shopifyTitle || p.title;
      const descHtml = (p.shopifyDesc || p.description || "").replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
      const tags = (p.shopifyTags || p.tags || "").split(",").map((t) => t.trim().replace(/_/g, " ")).filter(Boolean).slice(0, 250);

      const input: Record<string, unknown> = {
        title,
        descriptionHtml: descHtml,
        vendor: store.name,
        productType: "Personalized",
        status: "DRAFT",
        tags,
        ...(productOptions.length ? { productOptions } : {}),
        variants,
        ...(files.length ? { files } : {}),
      };
      // Đã đẩy trước đó → cập nhật đúng sản phẩm (không tạo trùng)
      const existingGid = (p as { shopifyProductId?: string }).shopifyProductId;
      if (existingGid) input.id = existingGid;

      const data = await shopifyGraphQL<{ productSet?: { product?: { id: string; handle: string }; userErrors?: { message: string }[] } }>(cred, MUT, { input });
      const ue = data.productSet?.userErrors ?? [];
      if (ue.length) { results.push({ id: p.id, title, ok: false, error: ue.map((e) => e.message).join("; ").slice(0, 200) }); continue; }
      const prod = data.productSet?.product;
      let mfErr: string | null = null;
      if (prod?.id) {
        await db.update(schema.etsyProducts).set({ shopifyProductId: prod.id, updatedAt: new Date() }).where(eq(schema.etsyProducts.id, p.id));
        mfErr = await pushPersonalization(cred, prod.id, (p as { personalization?: unknown }).personalization);
        await saveOwnFields(storeId, prod.id, (p as { personalization?: unknown }).personalization); // v171
      }
      results.push({ id: p.id, title, ok: true, handle: prod?.handle, ...(mfErr ? { error: "custom options not written: " + mfErr } : {}) });
    } catch (e) {
      results.push({ id: p.id, title: p.shopifyTitle || p.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }

  const created = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: created > 0, created, failed: results.length - created, store: store.name, results });
}
