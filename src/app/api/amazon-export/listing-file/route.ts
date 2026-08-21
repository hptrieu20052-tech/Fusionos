import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import * as XLSX from "xlsx";
import { DA_HEADER, DA_COL, DA_WIDTH } from "@/lib/amazon-flatfile-display-album";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/amazon-export/listing-file { ids }   (ids = amazon_products.id)
 *
 * Sinh FLAT FILE LISTING (File 1) — "Add Products via Upload" của Amazon, product type
 * DISPLAY_ALBUM (333 cột, dòng 1 chứa TemplateSignature GIỮ NGUYÊN).
 *
 * Mỗi sách = 1 dòng PARENT + mỗi variation của template 1 dòng CHILD:
 *   - Parent: item_sku {root}-PARENT-AMZ · Parent · variation_theme SizeName · title/desc/bullets, KHÔNG giá
 *   - Child : item_sku {root}-{suffix}   · Child · size_name + giá (our_price US) + quantity + ảnh
 *   - GTIN:  gtin_exemption_reason = "Manufacture on Demand" (hàng in theo yêu cầu, brand đã được duyệt exemption)
 *
 * Upload xong chờ listing LIVE + inventory > 0 rồi mới upload File 2 (customization).
 */
const MAX_IDS = 200;

type Variation = { suffix: string; label: string; price: string };
type Cfg = { skuSuffixes?: string[]; variations?: Variation[]; constants?: Record<string, string> };
type Img = { src?: string; position?: number };
type Variant = { sku?: string | null };

function rootSku(variants: unknown): string {
  const arr = (Array.isArray(variants) ? variants : []) as Variant[];
  for (const v of arr) {
    const s = String(v?.sku ?? "").trim();
    if (!s) continue;
    const parts = s.split("-").filter(Boolean);
    return parts.length >= 2 ? parts.slice(0, 2).join("-") : s;
  }
  return "";
}
function imgList(images: unknown): string[] {
  const arr = (Array.isArray(images) ? images : []) as Img[];
  return arr.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99))
    .map((i) => String(i?.src ?? "").trim()).filter((s) => /^https:\/\//i.test(s)).slice(0, 9);
}
const plain = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, MAX_IDS);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });

  const rows = await db.select({
    a: schema.amazonProducts,
    srcTitle: schema.shopifyProducts.title, srcTags: schema.shopifyProducts.tags,
    srcType: schema.shopifyProducts.productType,
    srcImages: schema.shopifyProducts.images, srcVariants: schema.shopifyProducts.variants,
    seller: schema.stores.sellerId,
  }).from(schema.amazonProducts)
    .leftJoin(schema.shopifyProducts, eq(schema.shopifyProducts.id, schema.amazonProducts.shopifyProductId))
    .leftJoin(schema.stores, eq(schema.stores.id, schema.amazonProducts.storeId))
    .where(inArray(schema.amazonProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const tpls = await db.select().from(schema.amazonTemplates);
  const tplFor = (amazonTemplateId: string | null, productType: string | null) => {
    if (amazonTemplateId) { const t = tpls.find((x) => x.id === amazonTemplateId); if (t) return t; }
    const pt = (productType ?? "").trim().toLowerCase();
    if (pt) { const t = tpls.find((x) => (x.productType ?? "").trim().toLowerCase() === pt); if (t) return t; }
    return tpls.length === 1 ? tpls[0] : null;
  };

  const skipped: string[] = [];
  const dataRows: string[][] = [];
  const mk = (): string[] => Array.from({ length: DA_WIDTH }, () => "");
  const set = (row: string[], key: string, val: string) => { const i = DA_COL[key]; if (i !== undefined && val) row[i] = val; };

  for (const r of rows) {
    const root = rootSku(r.srcVariants);
    const tpl = tplFor(r.a.amazonTemplateId, r.srcType);
    const cfg = (tpl?.config ?? {}) as Cfg;
    const vars = (cfg.variations ?? []).filter((v) => v.suffix);
    const cst = cfg.constants ?? {};
    const title = (r.a.title ?? "").trim();
    const bullets = ((r.a.bullets as string[] | null) ?? []).filter(Boolean);
    const desc = plain(r.a.description);
    // v297 · ưu tiên bộ ảnh override riêng Amazon (nếu có) — chỗ thay ảnh main nền trắng.
    const ovr = Array.isArray(r.a.images)
      ? (r.a.images as unknown[]).map((x) => String(x ?? "").trim()).filter((s) => /^https:\/\//i.test(s)).slice(0, 9)
      : [];
    const imgs = ovr.length ? ovr : imgList(r.srcImages);

    const missing: string[] = [];
    if (!root) missing.push("SKU");
    if (!tpl) missing.push("template");
    if (!vars.length) missing.push("variations");
    if (!title) missing.push("Amazon title");
    if (bullets.length < 5) missing.push(`bullets ${bullets.length}/5`);
    if (!desc) missing.push("description");
    if (!imgs.length) missing.push("images");
    if (vars.some((v) => !v.price)) missing.push("price");
    if (missing.length) { skipped.push(`${r.srcTitle ?? r.a.id}: thiếu ${missing.join(", ")}`); continue; }

    const brand = cst.brand || "Talewix";
    const common = (row: string[]) => {
      set(row, "feed_product_type", "displayalbum");
      set(row, "brand_name", brand);
      set(row, "manufacturer", cst.manufacturer || brand);
      set(row, "update_delete", "Update");
      set(row, "gtin_exemption_reason", "Manufacture on Demand");
      set(row, "item_type", cst.itemTypeKeyword || "baby-memory-books");
      set(row, "product_description", desc);
      bullets.slice(0, 5).forEach((bl, i) => set(row, `bullet_point${i + 1}`, bl));
      set(row, "generic_keywords", plain(r.srcTags).replace(/,/g, " ").replace(/\s+/g, " ").slice(0, 240));
      set(row, "color_name", cst.color || "Multicolor");
      set(row, "color_map", cst.colorMap || "Multicolor");
      set(row, "country_of_origin", cst.countryOfOrigin || "");
    };

    // PARENT — không giá, không quantity
    const parentSku = `${root}-PARENT-AMZ`;
    const p = mk();
    common(p);
    set(p, "item_sku", parentSku);
    set(p, "item_name", title);
    set(p, "parent_child", "Parent");
    set(p, "variation_theme", "SizeName");
    set(p, "main_image_url", imgs[0] ?? "");
    dataRows.push(p);

    // CHILDREN — mỗi variation 1 dòng, đủ giá + tồn kho + ảnh
    for (const v of vars) {
      const c = mk();
      common(c);
      set(c, "item_sku", `${root}-${v.suffix}`);
      set(c, "item_name", `${title} (${v.label || v.suffix})`.slice(0, 200));
      set(c, "parent_child", "Child");
      set(c, "parent_sku", parentSku);
      set(c, "relationship_type", "Variation");
      set(c, "variation_theme", "SizeName");
      set(c, "size_name", v.label || v.suffix);
      set(c, "number_of_items", cst.numberOfItems || "1");
      set(c, "condition_type", "New");
      set(c, "fulfillment_availability#1.fulfillment_channel_code", "DEFAULT");
      set(c, "fulfillment_availability#1.quantity", cst.quantity || "100");
      set(c, "fulfillment_availability#1.lead_time_to_ship_max_days", cst.leadTimeDays || "5");
      set(c, "purchasable_offer[marketplace_id=ATVPDKIKX0DER]#1.our_price#1.schedule#1.value_with_tax", v.price);
      set(c, "main_image_url", imgs[0] ?? "");
      imgs.slice(1, 9).forEach((u, i) => set(c, `other_image_url${i + 1}`, u));
      dataRows.push(c);
    }
  }

  if (!dataRows.length) return NextResponse.json({ ok: false, error: "Không sinh được dòng nào — " + (skipped[0] ?? "sản phẩm chưa đủ dữ liệu") }, { status: 400 });

  const aoa = [...DA_HEADER, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Template");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const fname = `amazon-listings-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "X-Rows": String(dataRows.length),
      "X-Skipped": String(skipped.length),
      "X-Skipped-First": encodeURIComponent(skipped[0] ?? ""),
    },
  });
}
