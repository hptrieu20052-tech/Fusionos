import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { buildListingFlatFile } from "@/lib/amazon-listing-file";
import { getSpConfig, spConfigured, createFeedDocument, uploadFeedContent, createFeed, getFeed, getFeedResult, sleep } from "@/lib/amazon-sp-api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/amazon-products/push-listing { ids, storeId? }
 *
 * ⬆ Push to Amazon — đẩy listing THẲNG qua Feeds API (POST_FLAT_FILE_LISTINGS_DATA),
 * dùng đúng nội dung flat file đã kiểm chứng chạy live. Không cần tải file + upload tay.
 * Chờ tối đa ~90s: nếu feed xử lý xong thì trả tóm tắt; chưa xong thì trả feedId (bấm Sync sau).
 */
function summarize(report: string): string {
  // Processing report của listings feed có phần "Feed Processing Summary" với số dòng OK/lỗi.
  const keep = report.split(/\r?\n/).filter((l) =>
    /processed|successful|error|warning|summary/i.test(l) && l.trim().length < 200);
  return keep.slice(0, 8).join(" · ").slice(0, 500) || "Đã xử lý — xem chi tiết ở Seller Central.";
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const storeId = typeof b?.storeId === "string" && /^[0-9a-f-]{36}$/i.test(b.storeId) ? b.storeId : undefined;
  const cfg = await getSpConfig(storeId);
  if (!spConfigured(cfg)) return NextResponse.json({ ok: false, error: "Chưa cấu hình SP-API — mở store Amazon ở mục Stores." }, { status: 400 });

  // Build nội dung flat file (đã đủ field, đã kiểm chứng)
  const built = await buildListingFlatFile(session, b?.ids);
  if (!built.ok) return NextResponse.json({ ok: false, error: built.error }, { status: built.status });

  // Đánh dấu các sản phẩm chuyển sang EXPORTED (đã đẩy)
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x)));

  let feedId = "";
  try {
    const doc = await createFeedDocument(cfg!);
    await uploadFeedContent(doc.url, built.txt);
    const feed = await createFeed(cfg!, doc.feedDocumentId);
    feedId = feed.feedId;
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Gửi feed lỗi: " + String((e as Error)?.message ?? e).slice(0, 160) }, { status: 502 });
  }

  // Đã gửi thành công → cập nhật trạng thái staged sang EXPORTED
  if (ids.length) {
    await db.update(schema.amazonProducts).set({ status: "EXPORTED", exportedAt: new Date(), updatedAt: new Date() })
      .where(inArray(schema.amazonProducts.id, ids)).catch(() => {});
  }

  // Poll ngắn xem feed xong chưa (nhiều khi vài phút — không chờ quá lâu)
  const deadline = Date.now() + 85_000;
  let statusStr = "IN_QUEUE";
  let summary = "";
  while (Date.now() < deadline) {
    await sleep(6000);
    try {
      const st = await getFeed(cfg!, feedId);
      statusStr = st.processingStatus;
      if (statusStr === "DONE" || statusStr === "FATAL" || statusStr === "CANCELLED") {
        if (st.resultFeedDocumentId) { try { summary = summarize(await getFeedResult(cfg!, st.resultFeedDocumentId)); } catch { /* bỏ qua */ } }
        break;
      }
    } catch { /* thử lại vòng sau */ }
  }

  const done = statusStr === "DONE";
  return NextResponse.json({
    ok: true,
    rows: built.rows,
    skipped: built.skipped,
    feedId,
    status: statusStr,
    done,
    summary: summary || (done ? "Feed xử lý xong." : `Feed đang xử lý (${statusStr}) — bấm ⟳ Sync sau vài phút để lấy ASIN.`),
  });
}
