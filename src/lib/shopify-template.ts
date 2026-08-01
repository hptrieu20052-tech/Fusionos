import { shopifyGraphQL, type ShopifyCred } from "@/lib/shopify";
import { collectionAddProducts, publishToPublications } from "@/lib/shopify-bulk";

// ============================================================================
//  ÁP TEMPLATE (full preset) lên sản phẩm Shopify qua productSet.
//  Dùng cho: (1) Push Etsy→Shopify (tạo mới), (2) bulk-edit listing đã có (đổi cả cấu trúc variants).
//  productSet set: options + variants (giá theo tổ hợp) + type/vendor/status/tags/templateSuffix/category.
//  Collections + Sales channels áp riêng sau khi có product id.
//  Category metafields (taxonomy attribute): gửi kèm metafields NẾU template có (namespace/key/type/value hợp lệ).
// ============================================================================

export type Template = {
  id: string; storeId: string; name: string;
  options: { name: string; values: string[] }[];
  variants: { options: Record<string, string>; price: string; compareAtPrice?: string | null; sku?: string }[];
  collectionIds: string[]; publicationIds: string[];
  status: string;
  productType: string | null; vendor: string | null; themeTemplate: string | null;
  category: { id: string; name: string } | null;
  categoryMetafields: { namespace: string; key: string; type: string; value: string }[];
};

const PRODUCT_SET = `mutation Apply($input: ProductSetInput!) {
  productSet(synchronous: true, input: $input) {
    product { id handle status }
    userErrors { field message }
  }
}`;

// Tổ hợp mọi variant từ options (cartesian) — dùng khi template chưa liệt kê sẵn combos.
function cartesian(options: { name: string; values: string[] }[]): Record<string, string>[] {
  if (!options.length) return [];
  return options.reduce<Record<string, string>[]>(
    (acc, opt) => acc.flatMap((c) => opt.values.map((v) => ({ ...c, [opt.name]: v }))),
    [{}],
  );
}

const priceKey = (opts: Record<string, string>) => Object.keys(opts).sort().map((k) => `${k}=${opts[k]}`).join("|");

// Xây variants cho productSet: mỗi tổ hợp → { optionValues, price, compareAtPrice?, sku?, inventoryItem }
function buildVariants(tpl: Template) {
  const combos = tpl.variants.length ? tpl.variants.map((v) => v.options) : cartesian(tpl.options);
  const priceMap = new Map(tpl.variants.map((v) => [priceKey(v.options), v]));
  return combos.slice(0, 100).map((opts) => {
    const hit = priceMap.get(priceKey(opts));
    const price = hit?.price && /^\d/.test(String(hit.price)) ? String(hit.price) : "0.00";
    const cap = hit?.compareAtPrice && /^\d/.test(String(hit.compareAtPrice)) ? String(hit.compareAtPrice) : null;
    return {
      optionValues: tpl.options.map((o) => ({ optionName: o.name, name: opts[o.name] })).filter((x) => x.name),
      price,
      ...(cap ? { compareAtPrice: cap } : {}),
      ...(hit?.sku ? { sku: hit.sku } : {}),
      inventoryItem: { tracked: false },
    };
  });
}

type BaseContent = { id?: string; title: string; descriptionHtml?: string; images?: string[] };

// Tuỳ chọn khi dựng input.
//  includeImages     – chỉ bật khi TẠO MỚI (productSet.files thay toàn bộ media).
//  statusOverride    – giữ nguyên trạng thái listing đang chạy thay vì ghi status của template.
//                      Bắt buộc dùng cho "Update Template": template DRAFT mà ghi đè lên 114 listing
//                      đang ACTIVE là gỡ nguyên shop khỏi Google trong 1 nốt nhạc.
//  extraMetafields   – metafield ghi kèm trong cùng 1 request (vd fusion.delivery).
//  skipCollections   – không thêm listing vào collectionIds của template (dùng cho Update Template).
export type TplInputOpts = {
  includeImages: boolean;
  statusOverride?: string | null;
  extraMetafields?: { namespace: string; key: string; type: string; value: string }[];
  skipCollections?: boolean;
};

// Tạo input ProductSet từ template + nội dung riêng của sản phẩm (title/desc/ảnh).
export function buildTemplateInput(tpl: Template, base: BaseContent, opts: TplInputOpts): Record<string, unknown> {
  const productOptions = tpl.options.map((o, i) => ({ name: o.name, position: i + 1, values: o.values.map((v) => ({ name: v })) }));
  const input: Record<string, unknown> = {
    title: base.title,
    ...(base.descriptionHtml != null ? { descriptionHtml: base.descriptionHtml } : {}),
    status: String(opts.statusOverride || tpl.status || "DRAFT").toUpperCase(),
    ...(tpl.productType ? { productType: tpl.productType } : {}),
    ...(tpl.vendor ? { vendor: tpl.vendor } : {}),
    ...(tpl.themeTemplate ? { templateSuffix: tpl.themeTemplate } : {}),
    ...(tpl.category?.id ? { category: tpl.category.id } : {}),
    ...(productOptions.length ? { productOptions } : {}),
    variants: buildVariants(tpl),
  };
  if (base.id) input.id = base.id;
  // Ảnh: chỉ set khi tạo mới (productSet.files thay toàn bộ media → tránh clobber ảnh listing cũ).
  if (opts.includeImages && base.images?.length) {
    input.files = base.images.filter(Boolean).slice(0, 12).map((src) => ({ originalSource: src, contentType: "IMAGE" }));
  }
  // Category metafields (best-effort) — chỉ gửi khi có namespace/key/type/value đầy đủ.
  // Cộng thêm extraMetafields (fusion.delivery) để chỉ tốn 1 request thay vì gọi metafieldsSet riêng.
  const mfs = [...(tpl.categoryMetafields ?? []), ...(opts.extraMetafields ?? [])]
    .filter((m) => m.namespace && m.key && m.type && String(m.value ?? "").trim() !== "");
  if (mfs.length) input.metafields = mfs.map((m) => ({ namespace: m.namespace, key: m.key, type: m.type, value: m.value }));
  return input;
}

// Áp template → productSet → collections + channels. Trả product id/handle hoặc lỗi.
export async function applyTemplate(
  cred: ShopifyCred, tpl: Template, base: BaseContent, opts: TplInputOpts,
): Promise<{ ok: boolean; productId?: string; handle?: string; error?: string }> {
  const input = buildTemplateInput(tpl, base, opts);
  let data: { productSet?: { product?: { id: string; handle: string }; userErrors?: { message: string }[] } };
  try {
    data = await shopifyGraphQL(cred, PRODUCT_SET, { input });
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 250) };
  }
  const ue = data.productSet?.userErrors ?? [];
  if (ue.length) return { ok: false, error: ue.map((x) => x.message).join("; ").slice(0, 250) };
  const prod = data.productSet?.product;
  if (!prod?.id) return { ok: false, error: "productSet returned no product" };

  // Collections + sales channels (không chặn kết quả chính — gom lỗi phụ)
  const warn: string[] = [];
  // skipCollections: "Update Template" KHÔNG đụng collection — listing đang chạy đã được xếp
  // collection theo dịp/chủ đề riêng, đẩy collection của template vào là loạn hết.
  if (!opts.skipCollections) for (const cid of tpl.collectionIds ?? []) {
    try { await collectionAddProducts(cred, cid, [prod.id]); } catch (e) { warn.push(`collection: ${String((e as Error)?.message ?? e).slice(0, 80)}`); }
  }
  if ((tpl.publicationIds ?? []).length) {
    try { await publishToPublications(cred, prod.id, tpl.publicationIds); } catch (e) { warn.push(`channels: ${String((e as Error)?.message ?? e).slice(0, 80)}`); }
  }
  return { ok: true, productId: prod.id, handle: prod.handle, ...(warn.length ? { error: "partial: " + warn.join("; ") } : {}) };
}
