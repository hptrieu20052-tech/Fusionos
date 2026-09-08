import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import JSZip from "jszip";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Img = { src: string; position?: number };
type Item = { id: string; adName: string; primary: string; headline: string };

/**
 * v441 · POST /api/shopify-products/meta-bulk
 * Body: { campaign, adset, items: [{ id, adName, primary, headline }], mode?, budget?, pixel? }
 *  - mode "single" (mặc định): mọi ad vào CHUNG 1 ad set đã có sẵn (khớp theo tên `adset`).
 *  - mode "per_ad" (v442 · vòng sàng lọc): MỖI ad 1 ad set MỚI `adset-NN`, kèm cột tạo ad set
 *    (Daily Budget = `budget` $/ngày, Paused, US, tối ưu Purchase; `pixel` = Pixel ID nếu có).
 *    Thiếu field nào Meta sẽ hỏi ở màn review import — điền 1 lần là xong.
 * → Trả về ZIP: meta-ads-import.csv + ảnh chính từng sản phẩm đặt tên trùng "Image File Name".
 *   Import: Ads Manager → ⋯ → Import & Export → Import Ads in Bulk → kéo CSV + chọn ảnh cùng lúc.
 * Đồng thời SET shopify_products.ads_at = now() cho các sản phẩm export (badge ADS).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null) as { campaign?: string; adset?: string; items?: Item[]; mode?: string; budget?: number; pixel?: string; campaignId?: string } | null;
  const campaign = (body?.campaign ?? "").trim();
  const campaignId = String(body?.campaignId ?? "").replace(/\D/g, "");   // v442c · khớp campaign theo ID, không tạo mới
  const adset = (body?.adset ?? "").trim();
  const perAd = body?.mode === "per_ad";
  const budget = Math.max(1, Math.min(1000, Number(body?.budget) || 5));
  const pixel = String(body?.pixel ?? "").replace(/\D/g, "");
  const items = (body?.items ?? []).filter((i) => i && i.id && i.adName);
  if (!campaign || !adset || !items.length) return NextResponse.json({ ok: false, error: "campaign, adset and items are required" }, { status: 400 });
  if (items.length > 50) return NextResponse.json({ ok: false, error: "max 50 ads per export" }, { status: 400 });

  const ids = items.map((i) => i.id);
  const prods = await db.select({
    id: schema.shopifyProducts.id, images: schema.shopifyProducts.images, onlineStoreUrl: schema.shopifyProducts.onlineStoreUrl,
  }).from(schema.shopifyProducts).where(inArray(schema.shopifyProducts.id, ids));
  const byId = new Map(prods.map((p) => [p.id, p]));

  // CSV bulk import — cột theo format export/import của Ads Manager. Ad ID để trống = TẠO MỚI,
  // Campaign/Ad Set khớp THEO TÊN với campaign & ad set đang có.
  // v442 · mode per_ad: thêm cột TẠO ad set mới (budget/trạng thái/US/tối ưu Purchase + pixel).
  // v442d · Age Min/Max + Bid Strategy: 3 field importer bắt buộc mà bỏ trống sẽ chặn Publish
  // (lỗi #1487842/#1487843/#2490487 — dò ra từ đợt First Birthday 09/2026).
  const adsetCols = perAd
    ? ["Ad Set Daily Budget", "Ad Set Run Status", "Countries", "Age Min", "Age Max", "Ad Set Bid Strategy", "Optimization Goal", "Billing Event", ...(pixel ? ["Optimized Conversion Tracking Pixels"] : [])]
    : [];
  // Có Campaign ID → gắn vào campaign ĐANG CÓ (không tạo mới). Không có ID → file tự mang
  // Objective/Buying Type để importer tạo campaign mới hợp lệ (Outcome Sales, Paused).
  const campCols = campaignId ? ["Campaign ID"] : ["Campaign Status", "Campaign Objective", "Buying Type"];
  const header = [...campCols, "Campaign Name", "Ad Set Name", ...adsetCols, "Ad Name", "Ad Status", "Creative Type", "Title", "Body", "Link Description", "Display Link", "Link", "Call to Action", "Image File Name"];
  const dataRows: string[][] = [header];

  const zip = new JSZip();
  const usedNames = new Set<string>();
  const skipped: string[] = [];
  let rowIdx = 0;
  for (const it of items) {
    const p = byId.get(it.id);
    if (!p) { skipped.push(it.adName + " (not found)"); continue; }
    const link = (p.onlineStoreUrl ?? "").trim();
    if (!link) { skipped.push(it.adName + " (no storefront link)"); continue; }
    const imgs = (Array.isArray(p.images) ? p.images as Img[] : []).slice().sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
    const src = imgs[0]?.src ?? "";
    // Tên file ảnh = Ad Name (an toàn ký tự), đuôi lấy từ URL — CSV và file trong ZIP trùng nhau.
    let imgFile = "";
    if (src) {
      const ext = (src.split("?")[0].match(/\.(jpe?g|png|webp|gif)$/i)?.[1] ?? "jpg").toLowerCase();
      const base = it.adName.replace(/[^\w-]/g, "").slice(0, 80) || "ad";
      let name = `${base}.${ext}`;
      for (let n = 2; usedNames.has(name); n++) name = `${base}-${n}.${ext}`;
      usedNames.add(name);
      try {
        const res = await fetch(src, { signal: AbortSignal.timeout(20000) });
        if (res.ok) { zip.file(name, Buffer.from(await res.arrayBuffer())); imgFile = name; }
      } catch { /* ảnh lỗi → dòng vẫn xuất, user gắn ảnh tay */ }
    }
    const host = link.replace(/^https?:\/\//, "").split("/")[0];
    rowIdx++;
    // per_ad: mỗi ad 1 ad set mới "adset-NN" (Paused — bật tay sau khi review).
    const adsetName = perAd ? `${adset}-${String(rowIdx).padStart(2, "0")}` : adset;
    const adsetVals = perAd
      ? [String(budget), "Paused", "US", "18", "65", "Lowest cost", "OFFSITE_CONVERSIONS", "IMPRESSIONS", ...(pixel ? [pixel] : [])]
      : [];
    const campVals = campaignId ? [campaignId] : ["Paused", "Outcome Sales", "Auction"];
    dataRows.push([
      ...campVals, campaign, adsetName, ...adsetVals, it.adName, "Paused", "Link Page Post Ad",
      it.headline, it.primary,
      "✓ Printed in the USA  ✓ Free US shipping  ✓ 30-day guarantee",
      host, link, "SHOP_NOW", imgFile,
    ]);
  }
  if (dataRows.length < 2) return NextResponse.json({ ok: false, error: "nothing to export: " + skipped.join("; ") }, { status: 400 });

  // v442b · Xuất .XLSX thay vì CSV — importer của Meta parse CSV có xuống dòng trong ô bị lỗi
  // "Spreadsheet didn't contain any rows"; Excel thì ăn chắc. xlsx = zip chứa XML, dựng bằng jszip.
  zip.file("meta-ads-import.xlsx", await buildXlsx(dataRows));
  if (skipped.length) zip.file("SKIPPED.txt", skipped.join("\n"));
  const buf: Buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  // Đánh dấu ĐÃ CHẠY ADS cho các sản phẩm có mặt trong file.
  await db.update(schema.shopifyProducts).set({ adsAt: sql`now()` }).where(inArray(schema.shopifyProducts.id, ids));

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="meta-ads-${new Date().toISOString().slice(0, 10)}.zip"`,
    },
  });
}

// v442b · Dựng file .xlsx tối giản (SpreadsheetML, inline strings — giữ được emoji + xuống dòng).
async function buildXlsx(rows: string[][]): Promise<Buffer> {
  const xmlEsc = (v: string) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const colL = (n: number) => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const body = rows.map((r, ri) =>
    `<row r="${ri + 1}">` + r.map((v, ci) =>
      `<c r="${colL(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`).join("") + "</row>").join("");
  const x = new JSZip();
  x.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  x.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  x.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ads" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  x.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  x.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`);
  return x.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
