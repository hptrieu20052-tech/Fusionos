import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/amazon-export/custom-file { templateId, ids }   (ids = amazon_products.id)
 *
 * Sinh file "Add product customizations in bulk" (.xlsx) cho Amazon:
 *   - 3 dòng header GIỮ NGUYÊN từ template (dòng 1 chứa ID template Amazon của account)
 *   - mỗi sách × mỗi skuSuffix = 1 dòng CHILD SKU: giá trị = defaults của template,
 *     thay cột Seller Sku = {root}-{suffix} (root = 2 đoạn đầu SKU variant Shopify, vd TLW-0011),
 *     thay cột Preview image = ảnh bìa (ảnh position 1) của sách đó.
 *
 * Amazon yêu cầu: listing phải LIVE + inventory > 0 trước khi upload file này (ghi trong Instructions).
 * Xuất xong đánh dấu status=EXPORTED + exported_at cho từng bản ghi.
 */
const MAX_IDS = 400;

type Cfg = {
  headerRows: string[][]; defaults: string[]; skuCol: number; previewImageCol: number;
  skuSuffixes: string[]; sheetName: string;
  variations?: { suffix: string; label: string; price: string }[];
};

function rootSku(variants: unknown): string {
  const arr = (Array.isArray(variants) ? variants : []) as { sku?: string | null }[];
  for (const v of arr) {
    const s = String(v?.sku ?? "").trim();
    if (!s) continue;
    const parts = s.split("-").filter(Boolean);
    if (parts.length >= 2) return parts.slice(0, 2).join("-");
    return s;
  }
  return "";
}

function coverUrl(images: unknown): string {
  const arr = (Array.isArray(images) ? images : []) as { src?: string; position?: number }[];
  const first = arr.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99)).find((i) => /^https:\/\//i.test(String(i?.src ?? "")));
  return first ? String(first.src) : "";
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const templateId = String(b?.templateId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(templateId)) return NextResponse.json({ ok: false, error: "templateId required" }, { status: 400 });
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, MAX_IDS);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });

  const [tpl] = await db.select().from(schema.amazonTemplates).where(eq(schema.amazonTemplates.id, templateId)).limit(1);
  if (!tpl) return NextResponse.json({ ok: false, error: "template not found" }, { status: 404 });
  const cfg = tpl.config as Cfg;
  if (!Array.isArray(cfg?.headerRows) || cfg.headerRows.length < 3 || !Array.isArray(cfg?.defaults)) {
    return NextResponse.json({ ok: false, error: "template config hỏng — upload lại master .xlsx" }, { status: 400 });
  }

  const rows = await db.select({
    id: schema.amazonProducts.id, title: schema.shopifyProducts.title,
    variants: schema.shopifyProducts.variants, images: schema.shopifyProducts.images,
    ovrImages: schema.amazonProducts.images,
    seller: schema.stores.sellerId,
  }).from(schema.amazonProducts)
    .leftJoin(schema.shopifyProducts, eq(schema.shopifyProducts.id, schema.amazonProducts.shopifyProductId))
    .leftJoin(schema.stores, eq(schema.stores.id, schema.amazonProducts.storeId))
    .where(inArray(schema.amazonProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // v288: variations là nguồn chính; skuSuffixes giữ để tương thích bản cũ.
  const suffixes = (cfg.variations?.map((v) => v.suffix) ?? cfg.skuSuffixes ?? []).filter(Boolean);
  if (!suffixes.length) return NextResponse.json({ ok: false, error: "template chưa có variations/skuSuffixes" }, { status: 400 });

  const skipped: string[] = [];
  const dataRows: string[][] = [];
  const okIds: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const root = rootSku(r.variants);
    if (!root) { skipped.push(r.title ?? r.id); continue; }
    okIds.push(r.id);
    // v297 · preview image ưu tiên ảnh override riêng Amazon
    const ovr = Array.isArray(r.ovrImages) ? (r.ovrImages as unknown[]).map((x) => String(x ?? "").trim()).find((s) => /^https:\/\//i.test(s)) : undefined;
    const img = ovr || coverUrl(r.images);
    for (const sfx of suffixes) {
      const sku = `${root}-${sfx}`;
      if (seen.has(sku)) continue;
      seen.add(sku);
      const row = [...cfg.defaults];
      row[cfg.skuCol ?? 0] = sku;
      if ((cfg.previewImageCol ?? -1) >= 0 && img) row[cfg.previewImageCol] = img;
      dataRows.push(row);
    }
  }
  if (!dataRows.length) return NextResponse.json({ ok: false, error: "không sinh được dòng nào — sản phẩm thiếu SKU variant" }, { status: 400 });

  // Đánh dấu đã export (không chặn nếu update lỗi — file vẫn trả về)
  if (okIds.length) {
    await db.update(schema.amazonProducts)
      .set({ status: "EXPORTED", exportedAt: new Date(), updatedAt: new Date() })
      .where(inArray(schema.amazonProducts.id, okIds)).catch(() => {});
  }

  const aoa = [...cfg.headerRows, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, cfg.sheetName || "Template");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const fname = `amazon-customizations-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "X-Rows": String(dataRows.length),
      "X-Skipped": String(skipped.length),
    },
  });
}
