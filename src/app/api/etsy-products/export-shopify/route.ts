import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/etsy-products/export-shopify { ids: string[] } — sinh file CSV import chuẩn Shopify
 * từ các listing Etsy đã chọn (chọn hàng loạt trên Manage Products Etsy).
 * Quy tắc chuyển đổi:
 *  - Biến thể: ghép đủ tổ hợp Variation1 × Variation2; giá trị chứa "digital" bị LOẠI
 *    (store Shopify bán bản in; digital cần app giao file riêng).
 *  - Ảnh: giữ link Etsy CDN — Shopify tự tải về host riêng lúc import.
 *  - Status = draft, Published = FALSE → duyệt + sửa GIÁ trước khi bật bán
 *    (CSV Etsy chỉ có 1 giá = giá variant rẻ nhất, KHÔNG có giá từng biến thể).
 *  - Seller chỉ export được listing thuộc store CỦA MÌNH.
 */
const COLS = ["Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published",
  "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value",
  "Variant SKU", "Variant Grams", "Variant Inventory Policy", "Variant Fulfillment Service",
  "Variant Price", "Variant Requires Shipping", "Variant Taxable", "Image Src", "Image Position", "Status"] as const;

const csvCell = (v: unknown) => {
  const t = String(v ?? "");
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const slugify = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/g, "");
const bodyHtml = (d: string) => d
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/\r\n/g, "\n").replace(/\n/g, "<br>");

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 300);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });

  const rows = await db.select({
    p: schema.etsyProducts, storeName: schema.stores.name, storeSeller: schema.stores.sellerId,
  }).from(schema.etsyProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.etsyProducts.storeId))
    .where(inArray(schema.etsyProducts.id, ids));
  if (!rows.length) return NextResponse.json({ ok: false, error: "no listings found" }, { status: 404 });

  // Scope: seller chỉ export listing của store mình
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.storeSeller || !scopeIds.includes(r.storeSeller))) {
    return NextResponse.json({ ok: false, error: "forbidden: some listings are not in your stores" }, { status: 403 });
  }

  const out: string[] = [COLS.join(",")];
  const seen = new Set<string>();
  for (const { p, storeName } of rows) {
    let handle = slugify(p.title); const base = handle; let i = 2;
    while (seen.has(handle)) { handle = `${base}-${i++}`; }
    seen.add(handle);

    const images = (Array.isArray(p.images) ? (p.images as string[]) : []).filter(Boolean);
    const vars = (Array.isArray(p.variations) ? (p.variations as { name?: string; values?: string[] }[]) : [])
      .map((v) => ({ name: String(v.name ?? ""), values: (v.values ?? []).filter((x) => !/digital/i.test(x)) }))
      .filter((v) => v.name && v.values.length);
    const [v1, v2] = [vars[0], vars[1]];
    const combos: [string, string][] = v1 && v2
      ? v1.values.flatMap((a) => v2.values.map((b) => [a, b] as [string, string]))
      : v1 ? v1.values.map((a) => [a, ""] as [string, string]) : [["", ""]];
    const price = p.price ?? "0";

    combos.forEach(([a, bv], idx) => {
      const r: Record<string, string> = Object.fromEntries(COLS.map((c) => [c, ""]));
      r.Handle = handle;
      if (idx === 0) {
        // Ưu tiên bản AI tối ưu SEO Shopify; chưa tối ưu thì fallback về dữ liệu gốc Etsy.
        r.Title = p.shopifyTitle || p.title;
        r["Body (HTML)"] = bodyHtml(p.shopifyDesc || p.description || "");
        r.Vendor = storeName ?? "";
        r.Type = "Personalized";
        r.Tags = (p.shopifyTags || p.tags || "").replace(/_/g, " ");
        r.Published = "FALSE"; r.Status = "draft";
        if (images.length) { r["Image Src"] = images[0]; r["Image Position"] = "1"; }
      }
      if (a) { if (idx === 0 && v1) r["Option1 Name"] = v1.name; r["Option1 Value"] = a; }
      if (bv) { if (idx === 0 && v2) r["Option2 Name"] = v2.name; r["Option2 Value"] = bv; }
      r["Variant SKU"] = p.sku ?? "";
      r["Variant Grams"] = "500";
      r["Variant Inventory Policy"] = "deny";
      r["Variant Fulfillment Service"] = "manual";
      r["Variant Price"] = String(price);
      r["Variant Requires Shipping"] = "TRUE";
      r["Variant Taxable"] = "TRUE";
      out.push(COLS.map((c) => csvCell(r[c])).join(","));
    });
    images.slice(1).forEach((u, k) => {
      const r: Record<string, string> = Object.fromEntries(COLS.map((c) => [c, ""]));
      r.Handle = handle; r["Image Src"] = u; r["Image Position"] = String(k + 2);
      out.push(COLS.map((c) => csvCell(r[c])).join(","));
    });
  }

  return new NextResponse(out.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="shopify-import-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
