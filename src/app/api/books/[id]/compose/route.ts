import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { buildMasterPrompt, BookBible } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";

// POST /api/books/[id]/compose { pageNo?, baked? }
// Ráp PROMPT CHI TIẾT (Bible + brief + text + restrictions) cho 1 trang hoặc tất cả các trang.
// Deterministic (không gọi AI) → nhanh, không đụng timeout. Ghi vào book_pages.prompt_template.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const [title] = await db.select().from(schema.bookTitles).where(eq(schema.bookTitles.id, params.id)).limit(1);
  if (!title) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const onePage = b?.pageNo != null ? Number(b.pageNo) : null;
  const baked = b?.baked !== false;
  const bible = (title.bible ?? null) as BookBible | null;
  const hasRef = !!title.characterRefKey;

  const rows = await db.select().from(schema.bookPages)
    .where(onePage != null
      ? and(eq(schema.bookPages.titleId, params.id), eq(schema.bookPages.pageNo, onePage))
      : eq(schema.bookPages.titleId, params.id))
    .orderBy(asc(schema.bookPages.pageNo));
  if (!rows.length) return NextResponse.json({ ok: false, error: "no pages" }, { status: 400 });

  const out: { pageNo: number; prompt: string }[] = [];
  for (const p of rows) {
    const prompt = buildMasterPrompt({
      bookName: title.name,
      bible,
      brief: p.illustrationBrief ?? "",
      text: p.textTemplate ?? "",
      hasRef,
      baked,
    });
    await db.update(schema.bookPages).set({ promptTemplate: prompt })
      .where(and(eq(schema.bookPages.titleId, params.id), eq(schema.bookPages.pageNo, p.pageNo)));
    out.push({ pageNo: p.pageNo, prompt });
  }
  return NextResponse.json({ ok: true, prompts: out });
}
