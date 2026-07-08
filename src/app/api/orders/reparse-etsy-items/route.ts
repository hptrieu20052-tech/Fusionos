import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, isNull, like } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST — dọn lại các item Etsy import bằng code cũ: tách variant + personalization khỏi product_title.
 * Chỉ đụng item có " — " trong title và chưa có variant (không đụng item đã sạch / gán tay).
 * KHÔNG xóa đơn — giữ nguyên design đã gán.
 */
export async function POST(_req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "orders")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // Sửa vài ký tự lỗi encoding hay gặp (best-effort)
  const fixMojibake = (s: string) => s
    .replace(/â€"|â‰£â‰£|â≣≣|Ã¢â‚¬â€œ/g, "–")
    .replace(/â€™/g, "’").replace(/â€œ/g, "“").replace(/â€\x9d/g, "”")
    .replace(/Ã©/g, "é").replace(/Ã¨/g, "è").replace(/\uFFFD/g, "");

  const rows = await db.select().from(schema.orderItems)
    .where(and(isNull(schema.orderItems.variant), like(schema.orderItems.productTitle, "% — %")));

  let updated = 0;
  for (const it of rows) {
    const full = it.productTitle;
    const idx = full.indexOf(" — ");
    if (idx < 0) continue;
    const title = fixMojibake(full.slice(0, idx).trim());
    let variations = full.slice(idx + 3).trim();

    // Tách "Personalization:..." (lấy hết phần sau, kể cả có dấu phẩy)
    let personalization = "";
    let variant = variations;
    const pIdx = variations.search(/personaliz\w*\s*:/i);
    if (pIdx >= 0) {
      const after = variations.slice(pIdx);
      const colon = after.indexOf(":");
      personalization = fixMojibake(after.slice(colon + 1).trim());
      variant = variations.slice(0, pIdx).replace(/[,;\s]+$/, "").trim();
    }
    variant = fixMojibake(variant);

    await db.update(schema.orderItems).set({
      productTitle: title,
      variant: variant || null,
      // chỉ điền personalization nếu item chưa có (không đè bản đã sửa tay)
      personalization: it.personalization || personalization || null,
    }).where(eq(schema.orderItems.id, it.id));
    updated++;
  }

  return NextResponse.json({ ok: true, scanned: rows.length, updated });
}
