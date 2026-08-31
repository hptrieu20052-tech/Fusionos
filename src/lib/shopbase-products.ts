// ============================================================================
//  SHOPBASE PRODUCTS — kéo sản phẩm về qua REST Admin API (/admin/products.json).
//  ĐỘC LẬP với hệ Shopify (GraphQL). Dùng cho trang "Manage Products · ShopBase".
//  ShopBase clone shape REST của Shopify: id SỐ, variants/images/options y hệt.
// ============================================================================
import { shopbaseApi, shopbaseHost, type ShopBaseCred } from "@/lib/shopbase";

export type SbVariant = {
  id: string; title: string; selectedOptions: { name: string; value: string }[];
  price: string; compareAtPrice: string | null; sku: string; barcode: string; inventoryQty: number | null;
};
export type SbImage = { id: string; src: string; altText: string; position: number };
export type SbOption = { name: string; position: number; values: string[] };
export type SbSyncedProduct = {
  shopbaseProductId: string; handle: string; title: string; bodyHtml: string;
  vendor: string; productType: string; tags: string; status: string;
  seoTitle: string; seoDescription: string;
  collections: { id: string; title: string }[];
  options: SbOption[]; variants: SbVariant[]; images: SbImage[];
  onlineStoreUrl: string | null; totalInventory: number | null;
};

const strv = (v: unknown) => (v == null ? "" : String(v)).trim();

type RawVariant = {
  id?: unknown; title?: unknown; price?: unknown; compare_at_price?: unknown; sku?: unknown; barcode?: unknown;
  inventory_quantity?: unknown; option1?: unknown; option2?: unknown; option3?: unknown;
};
type RawProduct = {
  id?: unknown; handle?: unknown; title?: unknown; body_html?: unknown; vendor?: unknown;
  product_type?: unknown; tags?: unknown; status?: unknown; published_at?: unknown;
  metafields_global_title_tag?: unknown; metafields_global_description_tag?: unknown;
  options?: { name?: unknown; position?: unknown; values?: unknown[] }[];
  images?: { id?: unknown; src?: unknown; alt?: unknown; position?: unknown }[];
  variants?: RawVariant[];
};

// tags REST có thể là string "a, b" hoặc mảng — chuẩn hoá về "a, b, c".
const tagsStr = (t: unknown) => Array.isArray(t) ? t.map(strv).filter(Boolean).join(", ") : strv(t);
// status ShopBase: active/draft/archived → ACTIVE/DRAFT/ARCHIVED (đồng bộ convention Shopify).
const upStatus = (s: unknown) => { const x = strv(s).toUpperCase(); return x === "ACTIVE" || x === "DRAFT" || x === "ARCHIVED" ? x : "DRAFT"; };

function normalize(p: RawProduct, host: string): SbSyncedProduct {
  const options: SbOption[] = (p.options ?? []).map((o, i) => ({
    name: strv(o.name), position: Number(o.position ?? i + 1),
    values: (Array.isArray(o.values) ? o.values : []).map(strv).filter(Boolean),
  }));
  const optNames = options.map((o) => o.name);
  const images: SbImage[] = (p.images ?? []).filter((im) => strv(im.src)).map((im, i) => ({
    id: strv(im.id), src: strv(im.src), altText: strv(im.alt), position: Number(im.position ?? i + 1),
  }));
  let inv = 0; let hasInv = false;
  const variants: SbVariant[] = (p.variants ?? []).map((v) => {
    const opts = [v.option1, v.option2, v.option3].map(strv);
    const selectedOptions = optNames.map((name, i) => ({ name, value: opts[i] ?? "" })).filter((s) => s.value);
    const q = v.inventory_quantity == null ? null : Number(v.inventory_quantity);
    if (q != null) { inv += q; hasInv = true; }
    return {
      id: strv(v.id), title: strv(v.title), selectedOptions,
      price: strv(v.price), compareAtPrice: v.compare_at_price == null || strv(v.compare_at_price) === "" ? null : strv(v.compare_at_price),
      sku: strv(v.sku), barcode: strv(v.barcode), inventoryQty: q,
    };
  });
  const handle = strv(p.handle);
  return {
    shopbaseProductId: strv(p.id), handle, title: strv(p.title),
    bodyHtml: strv(p.body_html), vendor: strv(p.vendor), productType: strv(p.product_type),
    tags: tagsStr(p.tags), status: upStatus(p.status),
    seoTitle: strv(p.metafields_global_title_tag), seoDescription: strv(p.metafields_global_description_tag),
    collections: [],   // REST products.json không kèm collections — để trống, bổ sung sau nếu cần.
    options, variants, images,
    onlineStoreUrl: handle && host ? `https://${host}/products/${handle}` : null,
    totalInventory: hasInv ? inv : null,
  };
}

/** Kéo TOÀN BỘ sản phẩm ShopBase (paginate since_id kiểu Shopify legacy). Trần trang chống chạy vô tận. */
export async function fetchAllShopbaseProducts(cred: ShopBaseCred, maxPages = 40): Promise<SbSyncedProduct[]> {
  const host = shopbaseHost(cred);
  const out: SbSyncedProduct[] = [];
  let sinceId = "0";
  for (let i = 0; i < maxPages; i++) {
    const qs = new URLSearchParams({ limit: "250", order: "id asc", since_id: sinceId });
    const j = await shopbaseApi(cred, `products.json?${qs}`);
    const batch = (Array.isArray(j.products) ? j.products : []) as RawProduct[];
    if (!batch.length) break;
    for (const p of batch) out.push(normalize(p, host));
    const lastId = strv(batch[batch.length - 1]?.id);
    if (!lastId || lastId === sinceId) break;
    sinceId = lastId;
    if (batch.length < 250) break;
  }
  return out;
}
