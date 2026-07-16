// Helper cho Manage Products Phase 3 (Clone / Edit). Resolve product→store→cfg (kèm scope seller),
// và map Get Product Detail (202309) → body Create/Edit Product.
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import type { Session } from "@/lib/auth";
import { storeOwnerScopeIds } from "@/lib/scope";
import { ttGetValidCfg, type TtCfg } from "@/lib/tiktok-shop";

type StoreRow = typeof schema.stores.$inferSelect;
type ProductRow = typeof schema.tiktokProducts.$inferSelect;

export type Resolved =
  | { ok: false; error: string; status: number }
  | { ok: true; row: ProductRow; store: StoreRow; cfg: TtCfg };

// Lấy row product + store + cfg TikTok. Chặn theo scope: seller chỉ thao tác product của store MÌNH.
export async function resolveProduct(session: Session, rowId: string): Promise<Resolved> {
  const [row] = await db.select().from(schema.tiktokProducts).where(eq(schema.tiktokProducts.id, rowId)).limit(1);
  if (!row) return { ok: false, error: "product not found", status: 404 };
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, row.storeId)).limit(1);
  if (!store) return { ok: false, error: "store not found", status: 404 };
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && !(store.sellerId && scopeIds.includes(store.sellerId))) return { ok: false, error: "forbidden", status: 403 };
  try {
    const cfg = await ttGetValidCfg(store.id, (store.apiCredentials ?? null) as Record<string, string> | null);
    return { ok: true, row, store, cfg };
  } catch (e) {
    return { ok: false, error: "Store not connected to TikTok: " + String((e as Error)?.message ?? e).slice(0, 150), status: 400 };
  }
}

export type SkuOverride = { sellerSku?: string; price?: string; quantity?: number };
export type ProductOverrides = {
  title?: string;
  description?: string;
  saveMode?: "LISTING" | "AS_DRAFT";
  skus?: SkuOverride[];        // theo index sku của product nguồn
  mainImageUris?: string[];    // nếu đổi ảnh (đã upload lấy uri) — chưa dùng ở iteration 1
  packageWeightGram?: string;  // cân nặng gói (gram)
  packageDim?: { length?: string; width?: string; height?: string }; // kích thước (cm)
};

/**
 * Detail (Get Product Detail 202309) → body Create/Edit Product 202309.
 * Tái dùng category leaf / brand / main_images(uri) / sales_attributes / package / product_attributes của nguồn
 * (clone CÙNG shop nên uri ảnh & attributes vẫn hợp lệ). Override: title, description, giá & tồn theo từng sku, save_mode.
 */
export function buildProductBody(detail: Record<string, unknown>, ov: ProductOverrides, fallbackWarehouseId?: string): Record<string, unknown> {
  const chains = (detail.category_chains as { id?: string; is_leaf?: boolean }[] | undefined) ?? [];
  const leaf = chains.find((c) => c.is_leaf) ?? chains[chains.length - 1];
  const brand = detail.brand as { id?: string } | undefined;
  const imgs = (detail.main_images as { uri?: string }[] | undefined) ?? [];
  const mainUris = (ov.mainImageUris && ov.mainImageUris.length)
    ? ov.mainImageUris
    : imgs.map((i) => i.uri).filter((u): u is string => !!u);

  const srcSkus = (detail.skus as Record<string, unknown>[] | undefined) ?? [];
  const skus = srcSkus.map((s, i) => {
    const o = ov.skus?.[i] ?? {};
    const price = s.price as { sale_price?: string; tax_exclusive_price?: string; currency?: string } | undefined;
    const inv = (s.inventory as { warehouse_id?: string; quantity?: number }[] | undefined) ?? [];
    const sa = (s.sales_attributes as { id?: string; name?: string; value_id?: string; value_name?: string; sku_img?: { uri?: string } }[] | undefined) ?? [];
    const amount = o.price ?? price?.sale_price ?? price?.tax_exclusive_price ?? "0";
    const currency = price?.currency ?? "USD";
    const invOut = (inv.length ? inv : [{ warehouse_id: fallbackWarehouseId, quantity: 0 }])
      .map((iv) => ({ warehouse_id: iv.warehouse_id ?? fallbackWarehouseId, quantity: o.quantity ?? Number(iv.quantity ?? 0) }))
      .filter((iv) => !!iv.warehouse_id);
    return {
      seller_sku: o.sellerSku ?? (s.seller_sku as string | undefined),
      sales_attributes: sa.map((a) => ({
        id: a.id, name: a.name, value_id: a.value_id, value_name: a.value_name,
        ...(a.sku_img?.uri ? { sku_img: { uri: a.sku_img.uri } } : {}),
      })),
      price: { amount: String(amount), currency },
      inventory: invOut,
    };
  });

  const attrs = (detail.product_attributes as { id?: string; values?: { id?: string; name?: string }[] }[] | undefined) ?? [];
  const productAttributes = attrs.map((a) => ({ id: a.id, values: (a.values ?? []).map((v) => ({ id: v.id, name: v.name })) }));

  // Package weight: override gram → {value, unit:GRAM}; else giữ nguồn.
  const packageWeight = (ov.packageWeightGram != null && ov.packageWeightGram !== "")
    ? { value: String(ov.packageWeightGram), unit: "GRAM" }
    : detail.package_weight;
  // Package dimensions: override cm (L/W/H) → unit CENTIMETER; else giữ nguồn.
  const d = ov.packageDim;
  const packageDimensions = (d && (d.length || d.width || d.height))
    ? { length: String(d.length ?? ""), width: String(d.width ?? ""), height: String(d.height ?? ""), unit: "CENTIMETER" }
    : detail.package_dimensions;

  const body: Record<string, unknown> = {
    save_mode: ov.saveMode ?? "AS_DRAFT",
    // Shop US (region shop) bắt buộc category V2 — nếu không khai sẽ lỗi 12052217.
    category_version: "v2",
    title: ov.title ?? (detail.title as string | undefined) ?? "",
    description: ov.description ?? (detail.description as string | undefined) ?? "",
    category_id: leaf?.id,
    main_images: mainUris.map((uri) => ({ uri })),
    skus,
    package_weight: packageWeight,
    product_attributes: productAttributes,
  };
  if (brand?.id) body.brand_id = brand.id;
  if (packageDimensions) body.package_dimensions = packageDimensions;
  return body;
}

// Rút gọn detail cho form review/editor (client không cần cả raw khổng lồ).
export function summarizeDetail(detail: Record<string, unknown>) {
  const chains = (detail.category_chains as { id?: string; local_name?: string; is_leaf?: boolean }[] | undefined) ?? [];
  const leaf = chains.find((c) => c.is_leaf) ?? chains[chains.length - 1];
  const imgs = (detail.main_images as { uri?: string; urls?: string[]; thumb_urls?: string[] }[] | undefined) ?? [];
  const skus = (detail.skus as Record<string, unknown>[] | undefined) ?? [];
  const pw = detail.package_weight as { value?: string; unit?: string } | undefined;
  const pd = detail.package_dimensions as { length?: string; width?: string; height?: string; unit?: string } | undefined;
  const attrs = (detail.product_attributes as { name?: string; values?: { name?: string }[] }[] | undefined) ?? [];
  return {
    title: (detail.title as string) ?? "",
    description: (detail.description as string) ?? "",
    status: (detail.status as string) ?? "",
    categoryId: leaf?.id ?? null,
    categoryName: (chains.map((c) => c.local_name).filter(Boolean).join(" · ")) || null,
    brand: (detail.brand as { name?: string } | undefined)?.name ?? null,
    images: imgs.map((i) => ({ uri: i.uri ?? "", url: i.urls?.[0] ?? i.thumb_urls?.[0] ?? "" })).filter((x) => x.uri || x.url),
    packageWeight: pw ? { value: pw.value ?? "", unit: pw.unit ?? "" } : null,
    packageDimensions: pd ? { length: pd.length ?? "", width: pd.width ?? "", height: pd.height ?? "", unit: pd.unit ?? "" } : null,
    attributes: attrs.map((a) => ({ name: a.name ?? "", values: (a.values ?? []).map((v) => v.name).filter(Boolean) })),
    skus: skus.map((s) => {
      const price = s.price as { sale_price?: string; tax_exclusive_price?: string; currency?: string } | undefined;
      const inv = (s.inventory as { quantity?: number }[] | undefined) ?? [];
      const sa = (s.sales_attributes as { value_name?: string }[] | undefined) ?? [];
      return {
        sellerSku: (s.seller_sku as string) ?? "",
        variant: sa.map((a) => a.value_name).filter(Boolean).join(" / "),
        price: price?.sale_price ?? price?.tax_exclusive_price ?? "",
        currency: price?.currency ?? "USD",
        quantity: inv.reduce((t, x) => t + Number(x.quantity ?? 0), 0),
      };
    }),
  };
}
