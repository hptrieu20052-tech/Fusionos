import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getSpConfig, spConfigured, getAmazonStoreId, getListingData, attrVal, attrVals, sleep } from "@/lib/amazon-sp-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/amazon-products/import-listing { sku, storeId? }
 *
 * Import 1 listing đã live trên Amazon (kể cả list TAY, không có nguồn Shopify) VỀ FusionOS.
 * Nhập SKU parent (…-PARENT-AMZ). Kéo title/bullets/description/product type/variations/giá/ảnh/ASIN
 * qua Listings Items API, tạo bản ghi amazon_products (manual — không cần Shopify). LUÔN trả JSON.
 */
function rootOf(parentSku: string): string {
  const s = parentSku.trim();
  const m = s.replace(/-PARENT-AMZ$/i, "").trim();
  if (m && m !== s) return m;
  const parts = s.split("-").filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, 2).join("-") : s;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const b = await req.json().catch(() => null);
    const parentSku = String(b?.sku ?? "").trim();
    if (!parentSku) return NextResponse.json({ ok: false, error: "Nhập SKU parent (…-PARENT-AMZ)" }, { status: 200 });

    const storeId = await getAmazonStoreId(typeof b?.storeId === "string" ? b.storeId : undefined);
    if (!storeId) return NextResponse.json({ ok: false, error: "Chưa có store Amazon ở mục Stores." }, { status: 200 });
    const cfg = await getSpConfig(storeId);
    if (!spConfigured(cfg)) return NextResponse.json({ ok: false, error: "Chưa cấu hình SP-API — mở store Amazon ở Stores." }, { status: 200 });

    const root = rootOf(parentSku);

    // Đã import rồi thì thôi (khớp theo manual_sku)
    const [dup] = await db.select({ id: schema.amazonProducts.id }).from(schema.amazonProducts)
      .where(and(eq(schema.amazonProducts.storeId, storeId), eq(schema.amazonProducts.manualSku, root))).limit(1);
    if (dup) return NextResponse.json({ ok: false, error: `Đã import rồi (SKU ${root}). Xem trong danh sách.` }, { status: 200 });

    const parent = await getListingData(cfg!, parentSku).catch((e) => { throw new Error("Đọc parent lỗi: " + String((e as Error)?.message ?? e)); });
    if (!parent) return NextResponse.json({ ok: false, error: `Không thấy listing SKU ${parentSku} trên Amazon (kiểm tra đúng SKU parent).` }, { status: 200 });

    const a = parent.attributes;
    const title = attrVal(a, "item_name");
    const bullets = attrVals(a, "bullet_point").slice(0, 5);
    const description = attrVal(a, "product_description");
    const productType = parent.productType || "";

    // Ảnh: main + other (nếu có URL)
    const imgs: string[] = [];
    const main = attrVal(a, "main_product_image_locator") || attrVal(a, "main_image_url");
    if (/^https?:\/\//i.test(main)) imgs.push(main);
    for (let i = 1; i <= 8; i++) {
      const u = attrVal(a, `other_product_image_locator_${i}`);
      if (/^https?:\/\//i.test(u)) imgs.push(u);
    }

    // Children từ relationships (childSkus). Lấy suffix + size + giá.
    const childSkus = (parent.relationships as { childSkus?: string[] }[]).flatMap((r) => r?.childSkus ?? []);
    const variations: { suffix: string; label: string; price: string }[] = [];
    for (const cs of childSkus.slice(0, 20)) {
      await sleep(250);
      const child = await getListingData(cfg!, cs, "attributes,offers,summaries").catch(() => null);
      if (!child) continue;
      const suffix = cs.startsWith(root + "-") ? cs.slice(root.length + 1) : cs;
      const label = attrVal(child.attributes, "size_name") || suffix;
      const off = (child.offers as { price?: { amount?: number | string } }[])[0];
      const price = off?.price?.amount != null ? String(off.price.amount) : "";
      variations.push({ suffix, label, price });
    }

    const [ins] = await db.insert(schema.amazonProducts).values({
      storeId,
      shopifyProductId: null,
      title: title || parentSku,
      bullets: bullets.length ? bullets : null,
      description: description || null,
      images: imgs.length ? imgs : null,
      variations: variations.length ? variations : null,
      manualSku: root,
      manualType: productType || null,
      asin: parent.asin || null,
      status: /BUYABLE|DISCOVERABLE/i.test(parent.status) ? "LIVE" : "EXPORTED",
      exportedAt: new Date(),
    }).returning({ id: schema.amazonProducts.id });

    return NextResponse.json({
      ok: true,
      id: ins.id,
      title, root, productType,
      variations: variations.length,
      asin: parent.asin,
      note: `Đã import "${(title || parentSku).slice(0, 40)}" · ${variations.length} size · ASIN ${parent.asin ?? "—"}`,
    });
  } catch (e) {
    console.error("import-listing fatal", e);
    return NextResponse.json({ ok: false, error: "Lỗi import: " + String((e as Error)?.message ?? e).slice(0, 220) }, { status: 200 });
  }
}
