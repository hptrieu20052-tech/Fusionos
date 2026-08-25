import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { isNotNull, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getSpConfig, spConfigured, getAmazonStoreId, getListingData, attrVals, sleep } from "@/lib/amazon-sp-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/amazon-products/shipping-groups
 *
 * Amazon KHÔNG có API liệt kê shipping template. Cách khả thi: đọc ngược
 * `merchant_shipping_group` ĐÃ LƯU trên các listing sống → gom tên distinct để user CHỌN (khỏi gõ tay sai).
 * Hạn chế: chỉ thấy template đã gán cho ≥1 listing. LUÔN trả JSON.
 */
type Variant = { sku?: string | null };

function rootSku(variants: unknown, manual: string | null): string {
  const arr = (Array.isArray(variants) ? variants : []) as Variant[];
  for (const v of arr) {
    const s = String(v?.sku ?? "").trim();
    if (!s) continue;
    const parts = s.split("-").filter(Boolean);
    return parts.length >= 2 ? parts.slice(0, 2).join("-") : s;
  }
  return manual ?? "";
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || (await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const storeId = await getAmazonStoreId(req.nextUrl.searchParams.get("storeId") ?? undefined);
    if (!storeId) return NextResponse.json({ ok: true, groups: [] });
    const cfg = await getSpConfig(storeId);
    if (!spConfigured(cfg)) return NextResponse.json({ ok: false, error: "SP-API not configured — open the Amazon store in Stores." }, { status: 200 });

    // Listing sống làm nguồn đọc (asin != null), lấy vài cái đại diện.
    const rows = await db.select({ a: schema.amazonProducts, v: schema.shopifyProducts.variants })
      .from(schema.amazonProducts)
      .leftJoin(schema.shopifyProducts, eq(schema.shopifyProducts.id, schema.amazonProducts.shopifyProductId))
      .where(isNotNull(schema.amazonProducts.asin))
      .limit(10);

    const groups = new Set<string>();
    const deadline = Date.now() + 50_000;
    for (const r of rows) {
      if (Date.now() > deadline || groups.size >= 12) break;
      const root = rootSku(r.v, r.a.manualSku);
      if (!root) continue;
      // Đọc parent để lấy childSkus (offer/shipping nằm ở child).
      const parent = await getListingData(cfg!, `${root}-PARENT-AMZ`, "attributes,relationships").catch(() => null);
      await sleep(200);
      if (!parent) continue;
      for (const g of attrVals(parent.attributes, "merchant_shipping_group")) groups.add(g);
      for (const g of attrVals(parent.attributes, "merchant_shipping_group_name")) groups.add(g);
      const childSkus = (parent.relationships as { childSkus?: string[] }[]).flatMap((x) => x?.childSkus ?? []);
      const cs = childSkus[0];
      if (cs) {
        const child = await getListingData(cfg!, cs, "attributes").catch(() => null);
        await sleep(200);
        if (child) {
          for (const g of attrVals(child.attributes, "merchant_shipping_group")) groups.add(g);
          for (const g of attrVals(child.attributes, "merchant_shipping_group_name")) groups.add(g);
        }
      }
    }

    return NextResponse.json({ ok: true, groups: Array.from(groups).filter(Boolean) });
  } catch (e) {
    console.error("shipping-groups fatal", e);
    return NextResponse.json({ ok: false, error: "Sync error: " + String((e as Error)?.message ?? e).slice(0, 200) }, { status: 200 });
  }
}
