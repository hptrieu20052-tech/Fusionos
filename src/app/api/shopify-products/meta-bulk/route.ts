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
  const body = await req.json().catch(() => null) as { campaign?: string; adset?: string; items?: Item[]; mode?: string; budget?: number; pixel?: string } | null;
  const campaign = (body?.campaign ?? "").trim();
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
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  // v442 · mode per_ad: thêm cột TẠO ad set mới (budget/trạng thái/US/tối ưu Purchase + pixel).
  const adsetCols = perAd
    ? ["Ad Set Daily Budget", "Ad Set Run Status", "Countries", "Optimization Goal", "Billing Event", "Custom Event Type", ...(pixel ? ["Optimized Conversion Tracking Pixels"] : [])]
    : [];
  const header = ["Campaign Name", "Ad Set Name", ...adsetCols, "Ad Name", "Ad Status", "Creative Type", "Title", "Body", "Link Description", "Display Link", "Link", "Call to Action", "Image File Name"];
  const lines: string[] = [header.map(esc).join(",")];

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
      ? [String(budget), "Paused", "US", "OFFSITE_CONVERSIONS", "IMPRESSIONS", "PURCHASE", ...(pixel ? [pixel] : [])]
      : [];
    lines.push([
      campaign, adsetName, ...adsetVals, it.adName, "Paused", "Link Page Post Ad",
      it.headline, it.primary,
      "✓ Printed in the USA  ✓ Free US shipping  ✓ 30-day guarantee",
      host, link, "SHOP_NOW", imgFile,
    ].map(esc).join(","));
  }
  if (lines.length < 2) return NextResponse.json({ ok: false, error: "nothing to export: " + skipped.join("; ") }, { status: 400 });

  // BOM để Excel/Meta đọc UTF-8 (emoji trong primary text) chuẩn.
  zip.file("meta-ads-import.csv", "\uFEFF" + lines.join("\r\n"));
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
