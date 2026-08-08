import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * POST /api/shopify-products/feed-export { ids, prefix? } → file TSV tải về.
 *
 * File này upload vào Merchant Center → Data sources → Add supplemental feed.
 * Feed phụ GHI ĐÈ title + description của feed chính theo cột `id`, KHÔNG đụng listing Shopify.
 *
 * CỘT id PHẢI TRÙNG TUYỆT ĐỐI với feed chính, nếu sai 1 ký tự Google BỎ QUA dòng đó, không báo lỗi.
 * Đã đối chiếu file export Merchant Center của Talewix (536/536 dòng):
 *      shopify_ZZ_<productId>_<variantId>
 * ZZ là feed label, KHÔNG phải "US". Vẫn cho sửa qua `prefix` phòng khi store khác dùng nhãn khác.
 * Mỗi VARIANT là 1 dòng — 1 sản phẩm 4 variant thì ra 4 dòng cùng title/description.
 */

const num = (gid: unknown) => {
  const m = String(gid ?? "").match(/(\d+)(?:[^\d]*)$/);
  return m ? m[1] : "";
};
// TSV: tab và xuống dòng là ký tự phân cách ⇒ phải triệt tận gốc, không escape nửa vời.
const cell = (s: unknown) => String(s ?? "").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x)));
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  const prefix = typeof b?.prefix === "string" && /^[A-Za-z0-9_]{1,20}$/.test(b.prefix.trim()) ? b.prefix.trim() : "ZZ";

  const rows = await db.select({
    id: schema.shopifyProducts.id,
    title: schema.shopifyProducts.title,
    gid: schema.shopifyProducts.shopifyProductId,
    variants: schema.shopifyProducts.variants,
    feedTitle: schema.shopifyProducts.feedTitle,
    feedDescription: schema.shopifyProducts.feedDescription,
    productType: schema.shopifyProducts.productType,
    seller: schema.stores.sellerId,
  }).from(schema.shopifyProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));

  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // v190 · shipping_label = slug của Product type ("Custom Shape Wooden Puzzle" → custom-shape-wooden-puzzle).
  // Trong GMC → Shipping policy → Products, chọn áp theo shipping label ĐÚNG chuỗi slug này.
  // Mỗi product type tự có label riêng — thêm type mới không phải sửa code.
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

  let skipped = 0;
  const lines: string[] = ["id\ttitle\tdescription\tshipping_label"];
  for (const r of rows) {
    const t = cell(r.feedTitle);
    const d = cell(r.feedDescription);
    // Chưa chạy "Generate Google feed copy" thì BỎ QUA — xuất dòng rỗng là ghi đè title bằng rỗng, hỏng feed.
    if (!t || !d) { skipped++; continue; }
    const pid = num(r.gid);
    if (!pid) { skipped++; continue; }
    const vs = (Array.isArray(r.variants) ? r.variants : []) as { id?: string }[];
    const vids = vs.map((v) => num(v?.id)).filter(Boolean);
    if (!vids.length) { skipped++; continue; }
    const label = slug(cell(r.productType));
    for (const vid of vids) lines.push(`shopify_${prefix}_${pid}_${vid}\t${t}\t${d}\t${label}`);
  }

  const body = lines.join("\n") + "\n";
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/tab-separated-values; charset=utf-8",
      "Content-Disposition": `attachment; filename="talewix-supplemental-feed.txt"`,
      "X-Feed-Rows": String(lines.length - 1),
      "X-Feed-Skipped": String(skipped),
    },
  });
}
