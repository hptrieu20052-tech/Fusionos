import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { buildMasterPrompt, BookBible } from "@/lib/ai/openrouter";
import { getBookProduct, coverFormatText, spreadFormatText, genBlocks } from "@/lib/book-products";

export const dynamic = "force-dynamic";

// POST /api/books/[id]/compose { pageNo?, baked? }
// Ráp PROMPT CHI TIẾT (Bible + brief + text + restrictions) cho 1 trang hoặc tất cả các trang.
// Deterministic (không gọi AI) → nhanh, không đụng timeout. Ghi vào book_pages.prompt_template.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (!(await can(s, "bookStudio"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const [title] = await db.select().from(schema.bookTitles).where(eq(schema.bookTitles.id, params.id)).limit(1);
  if (!title) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const onePage = b?.pageNo != null ? Number(b.pageNo) : null;
  const baked = b?.baked !== false;
  const bible = (title.bible ?? null) as BookBible | null;
  const hasRef = !!title.characterRefKey;

  const product = getBookProduct(title.productKey);
  const out: { pageNo: number; prompt: string }[] = [];

  // COVER (pageNo 0): ráp prompt bìa wraparound từ cover.brief + khổ cover. Chạy khi compose ALL hoặc chỉ định pageNo 0/-1.
  if (onePage == null || onePage === 0 || onePage === -1) {
    const cover = (title.cover ?? {}) as { text?: string; brief?: string; prompt?: string };
    const defaultBrief =
      "A single continuous wraparound cover scene.\n" +
      "RIGHT half = FRONT cover: the hero character (warm, magical) + a clear calm area for the book title.\n" +
      "LEFT half = BACK cover: the SAME scenery continuing seamlessly with NO title and NO extra characters — a restful open area.\n" +
      "Blend both halves into ONE unbroken image across the center fold.";
    const coverPrompt = buildMasterPrompt({
      bookName: title.name, bible,
      brief: (cover.brief ?? "").trim() || defaultBrief,
      text: baked ? ((cover.text ?? "").trim() || title.name) : "",
      hasRef, baked, format: coverFormatText(product),
    });
    await db.update(schema.bookTitles).set({ cover: { ...cover, prompt: coverPrompt } }).where(eq(schema.bookTitles.id, params.id));
    out.push({ pageNo: 0, prompt: coverPrompt });
  }

  // Các TRANG RUỘT — ráp theo KHỐI: trang đơn = 1 prompt; SPREAD (cặp) = 1 prompt LIỀN MẠCH dùng chung, ghi vào cả 2 trang.
  if (onePage == null || onePage >= 1) {
    const rows = await db.select().from(schema.bookPages)
      .where(eq(schema.bookPages.titleId, params.id)).orderBy(asc(schema.bookPages.pageNo));
    const byNo = new Map(rows.map((r) => [r.pageNo, r]));
    const setPrompt = async (pageNo: number, prompt: string) => {
      await db.update(schema.bookPages).set({ promptTemplate: prompt })
        .where(and(eq(schema.bookPages.titleId, params.id), eq(schema.bookPages.pageNo, pageNo)));
    };

    for (const blk of genBlocks(product)) {
      if (blk.type === "single") {
        if (onePage != null && onePage !== blk.page) continue;
        const p = byNo.get(blk.page); if (!p) continue;
        const prompt = buildMasterPrompt({ bookName: title.name, bible, brief: p.illustrationBrief ?? "", text: p.textTemplate ?? "", hasRef, baked });
        await setPrompt(blk.page, prompt);
        out.push({ pageNo: blk.page, prompt });
      } else if (blk.type === "spread") {
        const [L, R] = blk.pages;
        if (onePage != null && onePage !== L && onePage !== R) continue;
        const lp = byNo.get(L); const rp = byNo.get(R);
        if (!lp && !rp) continue;
        const lText = (lp?.textTemplate ?? "").trim();
        const rText = (rp?.textTemplate ?? "").trim();
        const combinedText = baked
          ? [lText && `LEFT half text: "${lText}"`, rText && `RIGHT half text: "${rText}"`].filter(Boolean).join("\n")
          : "";
        // 1 CẢNH LIỀN cho cả cặp — lấy brief của trang TRÁI làm cảnh chung (sửa được ở UI spread).
        let sharedBrief = (lp?.illustrationBrief ?? "").trim() || "One continuous scene spanning the whole double-page spread.";
        // Chữ 1 bên · tranh 1 bên: nửa có chữ = nền tĩnh dịu, KHÔNG nhân vật chính; chủ thể nằm trọn nửa kia.
        const textSide = lText && !rText ? "LEFT" : (!lText && rText ? "RIGHT" : null);
        if (textSide) {
          const artSide = textSide === "LEFT" ? "RIGHT" : "LEFT";
          sharedBrief += `\nLAYOUT: the ${textSide} half is the TEXT side — keep it a calm, open, softly-lit part of the same continuous scene (gentle background wash, small ambient details only, NO main characters there). Place the MAIN SUBJECT fully inside the ${artSide} half. Bake the caption text onto the ${textSide} half only, beautifully centered in the open area.`;
        }
        const prompt = buildMasterPrompt({
          bookName: title.name, bible,
          brief: sharedBrief,
          text: combinedText, hasRef, baked, format: spreadFormatText(product, L, R),
        });
        if (lp) await setPrompt(L, prompt);
        if (rp) await setPrompt(R, prompt);   // ghi chung để nhất quán; illustrate đọc trang trái
        out.push({ pageNo: L, prompt });
      }
    }
  }

  if (!out.length) return NextResponse.json({ ok: false, error: "no pages" }, { status: 400 });
  return NextResponse.json({ ok: true, prompts: out });
}
