import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/feed/supplemental?key=<FEED_FETCH_KEY>&store=<uuid>&prefix=ZZ
 *
 * URL CÔNG KHAI cho Merchant Center → Data sources → Add supplemental feed → Scheduled fetch.
 * Google tự vào lấy file này theo lịch (ngày 1 lần), khỏi phải Export .txt rồi upload tay mỗi lần.
 *
 * Google bot không đăng nhập được FUSION OS ⇒ không dùng session, chặn bằng khoá tĩnh
 * FEED_FETCH_KEY đặt trong biến môi trường Vercel. CHƯA đặt biến đó thì route trả 404 —
 * không bao giờ để dữ liệu store mở toang chỉ vì quên cấu hình.
 *
 * Định dạng id BẮT BUỘC trùng feed chính, đã đối chiếu 536/536 dòng của Talewix:
 *      shopify_ZZ_<productId>_<variantId>      (ZZ là feed label, không phải US)
 * Sai 1 ký tự thì Google bỏ qua dòng đó và KHÔNG báo lỗi.
 */

const num = (gid: unknown) => {
  const m = String(gid ?? "").match(/(\d+)(?:[^\d]*)$/);
  return m ? m[1] : "";
};
const cell = (s: unknown) => String(s ?? "").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();

// So sánh khoá theo kiểu không lộ độ dài qua thời gian phản hồi.
const sameKey = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

export async function GET(req: NextRequest) {
  const secret = String(process.env.FEED_FETCH_KEY ?? "").trim();
  if (secret.length < 16) return new NextResponse("not found", { status: 404 });

  const q = req.nextUrl.searchParams;
  if (!sameKey(String(q.get("key") ?? ""), secret)) return new NextResponse("not found", { status: 404 });

  const storeId = String(q.get("store") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return new NextResponse("store required", { status: 400 });
  const pfx = String(q.get("prefix") ?? "").trim();
  const prefix = /^[A-Za-z0-9_]{1,20}$/.test(pfx) ? pfx : "ZZ";

  const rows = await db.select({
    gid: schema.shopifyProducts.shopifyProductId,
    variants: schema.shopifyProducts.variants,
    feedTitle: schema.shopifyProducts.feedTitle,
    feedDescription: schema.shopifyProducts.feedDescription,
  }).from(schema.shopifyProducts).where(eq(schema.shopifyProducts.storeId, storeId));

  let skipped = 0;
  const lines: string[] = ["id\ttitle\tdescription"];
  for (const r of rows) {
    const t = cell(r.feedTitle);
    const d = cell(r.feedDescription);
    // Chưa có feed copy thì BỎ QUA. Xuất dòng rỗng = ghi đè title feed chính bằng rỗng ⇒ hỏng feed.
    if (!t || !d) { skipped++; continue; }
    const pid = num(r.gid);
    if (!pid) { skipped++; continue; }
    const vids = ((Array.isArray(r.variants) ? r.variants : []) as { id?: string }[]).map((v) => num(v?.id)).filter(Boolean);
    if (!vids.length) { skipped++; continue; }
    for (const vid of vids) lines.push(`shopify_${prefix}_${pid}_${vid}\t${t}\t${d}`);
  }

  return new NextResponse(lines.join("\n") + "\n", {
    status: 200,
    headers: {
      "Content-Type": "text/tab-separated-values; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Feed-Rows": String(lines.length - 1),
      "X-Feed-Skipped": String(skipped),
    },
  });
}
