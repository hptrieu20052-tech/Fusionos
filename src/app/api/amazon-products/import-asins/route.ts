import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/amazon-products/import-asins { text }
 *
 * Nhận nội dung "All Listings Report" / "Active Listings Report" của Amazon (TSV/CSV) —
 * tìm cột seller-sku + asin, khớp theo SKU ROOT (2 đoạn đầu) về từng amazon_product,
 * điền ASIN (ưu tiên dòng PARENT) + đổi status = LIVE. Không cần SP-API.
 */
function rootOf(sku: string): string {
  const parts = sku.split("-").filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, 2).join("-").toUpperCase() : sku.toUpperCase();
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const text = String(b?.text ?? "");
  if (!text.trim()) return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });

  // Tách dòng, đoán delimiter (tab hoặc phẩy)
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return NextResponse.json({ ok: false, error: "file trống hoặc thiếu dữ liệu" }, { status: 400 });
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const header = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const skuCol = header.findIndex((h) => /seller.?sku|^sku$/.test(h));
  const asinCol = header.findIndex((h) => /asin/.test(h));
  if (skuCol < 0 || asinCol < 0) {
    return NextResponse.json({ ok: false, error: `Không tìm thấy cột SKU/ASIN. Header đọc được: ${header.slice(0, 8).join(", ")}` }, { status: 400 });
  }

  // root -> { parent?: asin, any?: asin }
  const rootMap = new Map<string, { parent?: string; any?: string }>();
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(delim);
    const sku = String(cells[skuCol] ?? "").trim();
    const asin = String(cells[asinCol] ?? "").trim();
    if (!sku || !/^B0[0-9A-Z]{8}$/.test(asin)) continue;
    const root = rootOf(sku);
    const e = rootMap.get(root) ?? {};
    if (/-PARENT-/i.test(sku)) e.parent = asin; else if (!e.any) e.any = asin;
    rootMap.set(root, e);
  }
  if (!rootMap.size) return NextResponse.json({ ok: false, error: "Không đọc được cặp SKU–ASIN nào từ file" }, { status: 400 });

  // Duyệt amazon_products trong phạm vi, khớp theo root SKU của listing Shopify nguồn
  const rows = await db.select({
    id: schema.amazonProducts.id, variants: schema.shopifyProducts.variants, seller: schema.stores.sellerId,
  }).from(schema.amazonProducts)
    .leftJoin(schema.shopifyProducts, eq(schema.shopifyProducts.id, schema.amazonProducts.shopifyProductId))
    .leftJoin(schema.stores, eq(schema.stores.id, schema.amazonProducts.storeId));
  const scopeIds = await storeOwnerScopeIds(session);
  const scoped = scopeIds ? rows.filter((r) => r.seller && scopeIds.includes(r.seller)) : rows;

  let updated = 0;
  for (const r of scoped) {
    const arr = (Array.isArray(r.variants) ? r.variants : []) as { sku?: string | null }[];
    const firstSku = arr.map((v) => String(v?.sku ?? "").trim()).find(Boolean);
    if (!firstSku) continue;
    const root = rootOf(firstSku);
    const hit = rootMap.get(root);
    const asin = hit?.parent ?? hit?.any;
    if (!asin) continue;
    await db.update(schema.amazonProducts)
      .set({ asin, status: "LIVE", updatedAt: new Date() })
      .where(eq(schema.amazonProducts.id, r.id));
    updated++;
  }

  return NextResponse.json({ ok: true, updated, matched: rootMap.size });
}
