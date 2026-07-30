// ============================================================================
//  SHOPIFY PRODUCTS — two-way sync (kéo về + đẩy lên) qua GraphQL Admin API.
//  Dùng cho trang "Manage Products Shopify". REST products đã deprecate → GraphQL.
// ============================================================================
import { shopifyGraphQL, type ShopifyCred } from "@/lib/shopify";

export type SyncedVariant = {
  id: string; title: string; selectedOptions: { name: string; value: string }[];
  price: string; compareAtPrice: string | null; sku: string; barcode: string;
  inventoryItemId: string | null; inventoryQty: number | null;
};
export type SyncedImage = { id: string; src: string; altText: string; position: number };
export type SyncedOption = { name: string; position: number; values: string[] };
export type SyncedProduct = {
  shopifyProductId: string; handle: string; title: string; bodyHtml: string;
  vendor: string; productType: string; tags: string; status: string;
  seoTitle: string; seoDescription: string;
  options: SyncedOption[]; variants: SyncedVariant[]; images: SyncedImage[];
  onlineStoreUrl: string | null; totalInventory: number | null;
};

const money = (v: unknown): string => {
  // GraphQL trả price dạng "9.50" (chuỗi) hoặc {amount}
  if (v == null) return "";
  if (typeof v === "object" && v && "amount" in (v as Record<string, unknown>)) return String((v as { amount: unknown }).amount ?? "");
  return String(v);
};

const PRODUCTS_QUERY = `query Products($cursor: String) {
  products(first: 25, after: $cursor, sortKey: UPDATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id handle title descriptionHtml vendor productType status tags totalInventory onlineStoreUrl
      seo { title description }
      options { name position optionValues { name } }
      media(first: 20) { nodes { ... on MediaImage { id image { url altText } } } }
      variants(first: 100) {
        nodes { id title price compareAtPrice sku barcode inventoryQuantity
                selectedOptions { name value } inventoryItem { id } }
      }
    }
  }
}`;

type RawProduct = {
  id: string; handle?: string; title?: string; descriptionHtml?: string; vendor?: string;
  productType?: string; status?: string; tags?: string[]; totalInventory?: number | null; onlineStoreUrl?: string | null;
  seo?: { title?: string | null; description?: string | null } | null;
  options?: { name?: string; position?: number; optionValues?: { name?: string }[] }[];
  media?: { nodes?: { id?: string; image?: { url?: string; altText?: string | null } }[] };
  variants?: { nodes?: Record<string, unknown>[] };
};

function normalize(p: RawProduct): SyncedProduct {
  const options: SyncedOption[] = (p.options ?? []).map((o) => ({
    name: String(o.name ?? ""), position: Number(o.position ?? 0),
    values: (o.optionValues ?? []).map((v) => String(v.name ?? "")).filter(Boolean),
  }));
  const images: SyncedImage[] = (p.media?.nodes ?? []).filter((m) => m?.image?.url).map((m, i) => ({
    id: String(m.id ?? ""), src: String(m.image?.url ?? ""), altText: String(m.image?.altText ?? ""), position: i + 1,
  }));
  const variants: SyncedVariant[] = (p.variants?.nodes ?? []).map((v) => ({
    id: String(v.id ?? ""), title: String(v.title ?? ""),
    selectedOptions: Array.isArray(v.selectedOptions) ? (v.selectedOptions as { name: string; value: string }[]) : [],
    price: money(v.price), compareAtPrice: v.compareAtPrice == null ? null : money(v.compareAtPrice),
    sku: String(v.sku ?? ""), barcode: String(v.barcode ?? ""),
    inventoryItemId: (v.inventoryItem as { id?: string })?.id ?? null,
    inventoryQty: v.inventoryQuantity == null ? null : Number(v.inventoryQuantity),
  }));
  return {
    shopifyProductId: p.id, handle: String(p.handle ?? ""), title: String(p.title ?? ""),
    bodyHtml: String(p.descriptionHtml ?? ""), vendor: String(p.vendor ?? ""), productType: String(p.productType ?? ""),
    tags: (p.tags ?? []).join(", "), status: String(p.status ?? "DRAFT"),
    seoTitle: String(p.seo?.title ?? ""), seoDescription: String(p.seo?.description ?? ""),
    options, variants, images, onlineStoreUrl: p.onlineStoreUrl ?? null,
    totalInventory: p.totalInventory == null ? null : Number(p.totalInventory),
  };
}

// Kéo TOÀN BỘ sản phẩm của store (phân trang). Giới hạn 40 trang (~1000 sp) để an toàn thời gian chạy.
export async function fetchAllShopifyProducts(cred: ShopifyCred, maxPages = 40): Promise<SyncedProduct[]> {
  const out: SyncedProduct[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const data: { products?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string }; nodes?: RawProduct[] } } =
      await shopifyGraphQL(cred, PRODUCTS_QUERY, { cursor });
    const conn = data.products;
    for (const n of conn?.nodes ?? []) out.push(normalize(n));
    if (!conn?.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor ?? null;
    if (!cursor) break;
  }
  return out;
}

// Lấy 1 sản phẩm theo GID (dùng sau khi productSet để đồng bộ lại bản local với variant GID mới).
const ONE_QUERY = `query One($id: ID!) {
  product(id: $id) {
    id handle title descriptionHtml vendor productType status tags totalInventory onlineStoreUrl
    seo { title description }
    options { name position optionValues { name } }
    media(first: 20) { nodes { ... on MediaImage { id image { url altText } } } }
    variants(first: 100) {
      nodes { id title price compareAtPrice sku barcode inventoryQuantity
              selectedOptions { name value } inventoryItem { id } }
    }
  }
}`;
export async function fetchOneShopifyProduct(cred: ShopifyCred, gid: string): Promise<SyncedProduct | null> {
  const data = await shopifyGraphQL<{ product?: RawProduct | null }>(cred, ONE_QUERY, { id: gid });
  return data.product ? normalize(data.product) : null;
}

// ---- PUSH: đẩy chỉnh sửa local lên Shopify ----
const PRODUCT_UPDATE = `mutation U($product: ProductUpdateInput!) {
  productUpdate(product: $product) { product { id } userErrors { field message } }
}`;
const VARIANTS_UPDATE = `mutation VU($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
}`;
const MEDIA_DELETE = `mutation MD($productId: ID!, $mediaIds: [ID!]!) {
  productDeleteMedia(productId: $productId, mediaIds: $mediaIds) { deletedMediaIds userErrors { field message } }
}`;
const MEDIA_CREATE = `mutation MC($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) { media { id } mediaUserErrors { field message } }
}`;
const MEDIA_REORDER = `mutation MR($id: ID!, $moves: [MoveInput!]!) {
  productReorderMedia(id: $id, moves: $moves) { userErrors { field message } }
}`;
const MEDIA_LIST = `query M($id: ID!) {
  product(id: $id) { media(first: 50) { nodes { ... on MediaImage { id } } } }
}`;

type LocalProduct = {
  shopifyProductId: string; title: string; bodyHtml: string | null; tags: string | null;
  status: string; vendor: string | null; productType: string | null;
  seoTitle?: string | null; seoDescription?: string | null;
  variants: SyncedVariant[]; images: SyncedImage[];
};

function ue(arr: unknown): string {
  const a = Array.isArray(arr) ? arr as { message?: string }[] : [];
  return a.map((e) => e.message).filter(Boolean).join("; ");
}

/**
 * Đẩy 1 sản phẩm: cập nhật field sản phẩm + giá/sku từng variant + ảnh (xóa/thêm/sắp xếp).
 * `remoteImages` = ảnh hiện đang có trên Shopify (để tính ảnh nào xóa). Ảnh mới = src http chưa có id GID.
 */
export async function pushProductToShopify(
  cred: ShopifyCred, local: LocalProduct,
): Promise<{ ok: boolean; error?: string }> {
  const pid = local.shopifyProductId;
  // 1) Field sản phẩm
  const r1 = await shopifyGraphQL<{ productUpdate?: { userErrors?: unknown } }>(cred, PRODUCT_UPDATE, {
    product: {
      id: pid, title: local.title, descriptionHtml: local.bodyHtml ?? "",
      status: (local.status || "DRAFT").toUpperCase(),
      vendor: local.vendor ?? undefined, productType: local.productType ?? undefined,
      tags: (local.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      ...((local.seoTitle != null || local.seoDescription != null)
        ? { seo: { title: local.seoTitle ?? "", description: local.seoDescription ?? "" } } : {}),
    },
  });
  const e1 = ue(r1.productUpdate?.userErrors); if (e1) return { ok: false, error: "product: " + e1 };

  // 2) Variants (giá/compare/sku) — chỉ variant có id GID (đã tồn tại trên Shopify)
  const vin = local.variants.filter((v) => v.id?.startsWith("gid://")).map((v) => ({
    id: v.id, price: v.price || "0",
    ...(v.compareAtPrice != null && String(v.compareAtPrice).trim() !== "" ? { compareAtPrice: v.compareAtPrice } : {}),
    ...(v.sku != null ? { inventoryItem: { sku: v.sku } } : {}),
    ...(v.barcode ? { barcode: v.barcode } : {}),
  }));
  if (vin.length) {
    const r2 = await shopifyGraphQL<{ productVariantsBulkUpdate?: { userErrors?: unknown } }>(cred, VARIANTS_UPDATE, { productId: pid, variants: vin });
    const e2 = ue(r2.productVariantsBulkUpdate?.userErrors); if (e2) return { ok: false, error: "variants: " + e2 };
  }

  // 3) Ảnh — truy vấn media HIỆN CÓ trên Shopify để tính ảnh cần xóa (local đã bỏ ảnh nào thì xóa ảnh đó).
  let remoteImageIds: string[] = [];
  try {
    const rl = await shopifyGraphQL<{ product?: { media?: { nodes?: { id?: string }[] } } }>(cred, MEDIA_LIST, { id: pid });
    remoteImageIds = (rl.product?.media?.nodes ?? []).map((n) => String(n.id ?? "")).filter(Boolean);
  } catch { /* nếu lỗi thì bỏ qua bước xóa cho an toàn */ }
  const localIds = new Set(local.images.filter((im) => im.id).map((im) => im.id));
  const toDelete = remoteImageIds.filter((id) => id && !localIds.has(id));
  if (toDelete.length) {
    const rd = await shopifyGraphQL<{ productDeleteMedia?: { userErrors?: unknown } }>(cred, MEDIA_DELETE, { productId: pid, mediaIds: toDelete });
    const ed = ue(rd.productDeleteMedia?.userErrors); if (ed) return { ok: false, error: "delete image: " + ed };
  }
  const toAdd = local.images.filter((im) => !im.id && /^https?:\/\//i.test(im.src));
  if (toAdd.length) {
    const rc = await shopifyGraphQL<{ productCreateMedia?: { mediaUserErrors?: unknown } }>(cred, MEDIA_CREATE, {
      productId: pid, media: toAdd.map((im) => ({ originalSource: im.src, alt: im.altText || undefined, mediaContentType: "IMAGE" })),
    });
    const ec = ue(rc.productCreateMedia?.mediaUserErrors); if (ec) return { ok: false, error: "add image: " + ec };
  }
  // Sắp xếp: chỉ với ảnh đã có id (ảnh mới thêm chưa có id ngay) — di chuyển theo vị trí local
  const ordered = local.images.filter((im) => im.id);
  if (ordered.length > 1) {
    const moves = ordered.map((im, i) => ({ id: im.id, newPosition: String(i) }));
    await shopifyGraphQL(cred, MEDIA_REORDER, { id: pid, moves }).catch(() => { /* reorder không chặn push */ });
  }
  return { ok: true };
}
