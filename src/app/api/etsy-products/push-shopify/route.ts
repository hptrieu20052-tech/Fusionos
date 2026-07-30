import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopifyGraphQL, shopHost, type ShopifyCred } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 100);
  const storeId = String(b?.storeId ?? "").trim();
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

  const results: { id: string; title: string; ok: boolean; handle?: string; error?: string }[] = [];
  for (const { p } of rows) {
    try {
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
      if (prod?.id) {
        await db.update(schema.etsyProducts).set({ shopifyProductId: prod.id, updatedAt: new Date() }).where(eq(schema.etsyProducts.id, p.id));
      }
      results.push({ id: p.id, title, ok: true, handle: prod?.handle });
    } catch (e) {
      results.push({ id: p.id, title: p.shopifyTitle || p.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }

  const created = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: created > 0, created, failed: results.length - created, store: store.name, results });
}
