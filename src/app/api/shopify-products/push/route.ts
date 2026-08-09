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
import { hitsSummary, type PolicyHit } from "@/lib/policy-scan";

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

// v190 · TỰ GÁN SHIPPING PROFILE THEO PRODUCT TYPE.
// Quy ước tự cấu hình — KHÔNG cần bảng map: shipping profile Shopify nào có TÊN TRÙNG (không phân
// biệt hoa thường) với Product type của sản phẩm (vd profile "Custom Shape Wooden Puzzle") thì sau
// khi Push, toàn bộ variant của sản phẩm được đưa vào profile đó — khỏi vào Settings gán tay.
// Không có profile trùng tên → không đụng gì (sản phẩm nằm General profile như mặc định Shopify).
// Cần scope read_shipping + write_shipping; thiếu scope thì bỏ qua êm, Push vẫn thành công.
const PROFILES_Q = `query fusionProfiles { deliveryProfiles(first: 25) { edges { node { id name default } } } }`;
const PROFILE_ASSIGN = `mutation fusionAssign($id: ID!, $profile: DeliveryProfileInput!) {
  deliveryProfileUpdate(id: $id, profile: $profile) { userErrors { field message } }
}`;
type ProfileMap = Map<string, string>; // lower(tên profile) → profile GID (bỏ profile default)
async function loadProfiles(cred: ShopifyCred): Promise<ProfileMap> {
  const map: ProfileMap = new Map();
  try {
    const d = await shopifyGraphQL<{ deliveryProfiles?: { edges?: { node?: { id?: string; name?: string; default?: boolean } }[] } }>(cred, PROFILES_Q);
    for (const e of d.deliveryProfiles?.edges ?? []) {
      const n = e?.node;
      if (n?.id && n?.name && !n.default) map.set(String(n.name).trim().toLowerCase(), String(n.id));
    }
  } catch { /* thiếu read_shipping / lỗi mạng → coi như không có profile custom */ }
  return map;
}
async function assignDeliveryProfile(
  cred: ShopifyCred, profiles: ProfileMap, productType: string | null | undefined, gid: string, knownVariantGids?: string[],
): Promise<string> {
  const key = String(productType ?? "").trim().toLowerCase();
  if (!key) return "";
  const profileId = profiles.get(key);
  if (!profileId) return ""; // không có profile trùng tên type → để General, không làm gì
  try {
    let vids = (knownVariantGids ?? []).filter((x) => x.startsWith("gid://"));
    if (!vids.length) {
      const fresh = await fetchOneShopifyProduct(cred, gid);
      vids = (fresh?.variants ?? []).map((v) => String(v.id ?? "")).filter((x) => x.startsWith("gid://"));
    }
    if (!vids.length) return "shipping profile: no variant GIDs yet — run Sync then Push again";
    const d = await shopifyGraphQL<{ deliveryProfileUpdate?: { userErrors?: { message?: string }[] } }>(
      cred, PROFILE_ASSIGN, { id: profileId, profile: { variantsToAssociate: vids } },
    );
    const errs = d.deliveryProfileUpdate?.userErrors ?? [];
    return errs.length ? "shipping profile: " + errs.map((x) => x.message).join("; ").slice(0, 100) : "";
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    return "shipping profile: " + (/access|scope/i.test(m) ? "app thiếu scope write_shipping — thêm scope rồi Install lại app" : m.slice(0, 100));
  }
}

type Row = typeof schema.shopifyProducts.$inferSelect;

// v195 · fusion.delivery ghi NGAY trong productSet lúc TẠO MỚI — widget Estimated delivery trên theme
// hiện đúng số của template từ giây đầu, không phải nhớ bấm "Push delivery" riêng cho listing mới.
// (Cùng luật số với /api/shopify-products/push-delivery: chỉ ghi cặp min-max đầy đủ.)
type TplShip = {
  shipProcMin?: number | null; shipProcMax?: number | null;
  shipUsMin?: number | null; shipUsMax?: number | null;
  shipIntlMin?: number | null; shipIntlMax?: number | null;
  shipCountries?: unknown; shipCutoffHour?: number | null;
};
function deliveryValueOf(tpl: Template | null | undefined): string | null {
  if (!tpl) return null;
  const t = tpl as unknown as TplShip;
  const pair = (min?: number | null, max?: number | null): [number, number] | null =>
    (min == null || max == null) ? null : [Math.min(min, max), Math.max(min, max)];
  const cty: Record<string, [number, number]> = {};
  if (t.shipCountries && typeof t.shipCountries === "object") {
    for (const [k, a] of Object.entries(t.shipCountries as Record<string, unknown>)) {
      if (!Array.isArray(a) || a.length !== 2) continue;
      const lo = Number(a[0]), hi = Number(a[1]);
      if (!isFinite(lo) || !isFinite(hi) || lo < 0 || hi < 0) continue;
      cty[k.toLowerCase()] = [Math.min(lo, hi), Math.max(lo, hi)];
    }
  }
  const proc = pair(t.shipProcMin, t.shipProcMax);
  const us = pair(t.shipUsMin, t.shipUsMax);
  const intl = pair(t.shipIntlMin, t.shipIntlMax);
  if (!proc && !us && !intl && !Object.keys(cty).length) return null;
  const payload: Record<string, unknown> = {};
  if (proc) payload.proc = proc;
  if (us) payload.us = us;
  if (intl) payload.intl = intl;
  if (Object.keys(cty).length) payload.cty = cty;
  if (t.shipCutoffHour != null) payload.cutoff = t.shipCutoffHour;
  return JSON.stringify(payload);
}

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
  // v195 · kèm luôn fusion.delivery (số ngày giao của template) trong cùng request tạo
  const dv = deliveryValueOf(tpl);
  const allMfs = [
    ...catMfs.map((m) => ({ namespace: m.namespace, key: m.key, type: m.type, value: m.value })),
    ...(dv ? [{ namespace: "fusion", key: "delivery", type: "json", value: dv }] : []),
  ];
  if (allMfs.length) input.metafields = allMfs;
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
// v173 · Cộng thêm collection RIÊNG của bản nháp (do AI Auto-Collection chọn, lưu ở p.collections) —
// union với collection của template, khử trùng theo id. Lỗi phụ không chặn kết quả chính.
async function applyTplExtras(cred: ShopifyCred, tpl: Template | null, gid: string, ownCollections?: unknown): Promise<string> {
  const warn: string[] = [];
  const own = (Array.isArray(ownCollections) ? ownCollections as { id?: string }[] : []).map((c) => String(c?.id ?? "")).filter(Boolean);
  const cids = Array.from(new Set([...(tpl?.collectionIds ?? []), ...own]));
  for (const cid of cids) {
    try { await collectionAddProducts(cred, cid, [gid]); } catch (e) { warn.push("collection: " + String((e as Error)?.message ?? e).slice(0, 80)); }
  }
  if (tpl && (tpl.publicationIds ?? []).length) {
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
  // v206 · HIGH risk không còn chặn cứng: admin bấm "Push anyway" ⇒ override:true ⇒ vẫn đẩy.
  // CHỈ admin mới bỏ qua được — seller gửi override cũng vô hiệu (vẫn bị chặn).
  const overrideHigh = b?.override === true && session.role === "admin";

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
  // v190 · nạp shipping profiles 1 lần / store trong request (lazy)
  const profCache = new Map<string, ProfileMap>();
  const profilesFor = async (cred: ShopifyCred): Promise<ProfileMap> => {
    const host = shopHost(cred);
    let m = profCache.get(host);
    if (!m) { m = await loadProfiles(cred); profCache.set(host, m); }
    return m;
  };
  for (const r of rows) {
    const cred = (r.cred ?? {}) as ShopifyCred;
    if (r.mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
      results.push({ id: r.p.id, title: r.p.title, ok: false, error: "store chưa cấu hình Shopify API" }); continue;
    }
    try {
      // ---- v179/v206 · CẢNH BÁO policy theo kết quả AI POLICY AUDIT đã lưu. HIGH mặc định chặn,
      // NHƯNG admin có thể xác nhận "Push anyway" (override) để đẩy qua — người quyết cuối là admin,
      // AI chỉ tư vấn. Seller không có override ⇒ vẫn bị chặn như cũ.
      if (r.p.policyRisk === "high" && !overrideHigh) {
        const hits = (Array.isArray(r.p.policyHits) ? r.p.policyHits : []) as PolicyHit[];
        results.push({ id: r.p.id, title: r.p.title, ok: false, error: "BLOCKED — policy audit found HIGH risk: " + hitsSummary(hits) + ". Apply the suggested fixes and re-run AI policy check, or confirm to push anyway." });
        continue;
      }
      if (r.p.policyRisk === "high" && overrideHigh) {
        console.warn(`[policy-override] admin ${session.sub} pushed HIGH-risk product ${r.p.id} "${r.p.title}"`);
      }

      // ---- v172 · Bản nháp stage từ Etsy: TẠO MỚI thay vì update ----
      if (!r.p.shopifyProductId) {
        const tpl = r.p.templateId ? tplById.get(r.p.templateId) ?? null : null;
        const made = await createOnShopify(cred, r.p, tpl);
        if (!made.gid) { results.push({ id: r.p.id, title: r.p.title, ok: false, error: made.error ?? "create failed" }); continue; }
        const warn0 = await applyTplExtras(cred, tpl, made.gid, r.p.collections);
        await adoptCreated(cred, r.p, made.gid);
        // v190 · profile trùng tên Product type → gán variants vào (adoptCreated đã nạp variant GID vào DB, helper tự refetch)
        const wProf = await assignDeliveryProfile(cred, await profilesFor(cred), r.p.productType, made.gid);
        const warn = [warn0, wProf].filter(Boolean).join("; ");
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
        // v190 · update path: dùng luôn variant GID vừa đọc lại, khỏi gọi thêm API
        const wProf = await assignDeliveryProfile(
          cred, await profilesFor(cred), fresh?.productType ?? r.p.productType, r.p.shopifyProductId,
          (fresh?.variants ?? []).map((v) => String((v as SyncedVariant).id ?? "")),
        );
        results.push({ id: r.p.id, title: r.p.title, ok: true, ...(wProf ? { error: "partial: " + wProf } : {}) });
      } else if (/does not exist|doesn'?t exist|not found/i.test(res.error ?? "")) {
        // v172 · Sản phẩm đã bị XOÁ tay trên Shopify mà bản ghi vẫn giữ GID cũ → tự gỡ liên kết
        // và TẠO LẠI ngay trong lần Push này (nội dung lấy từ bản local đang có).
        const tpl = r.p.templateId ? tplById.get(r.p.templateId) ?? null : null;
        const made = await createOnShopify(cred, r.p, tpl);
        if (!made.gid) { results.push({ id: r.p.id, title: r.p.title, ok: false, error: "old product was deleted on Shopify; re-create failed: " + (made.error ?? "") }); continue; }
        const warn0 = await applyTplExtras(cred, tpl, made.gid, r.p.collections);
        await adoptCreated(cred, { ...r.p, shopifyProductId: made.gid }, made.gid);
        const wProf = await assignDeliveryProfile(cred, await profilesFor(cred), r.p.productType, made.gid);
        const warn = [warn0, wProf].filter(Boolean).join("; ");
        results.push({ id: r.p.id, title: r.p.title, ok: true, ...(warn ? { error: "partial: " + warn } : {}) });
      } else results.push({ id: r.p.id, title: r.p.title, ok: false, error: res.error });
    } catch (e) {
      results.push({ id: r.p.id, title: r.p.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  const pushed = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: pushed > 0, pushed, failed: results.length - pushed, results });
}
