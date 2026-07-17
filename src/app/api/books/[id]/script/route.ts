import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { generateBookScript } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/books/[id]/script { pages?, vars? } — AI sinh kịch bản từ concept của title, ghi đè book_pages.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const [title] = await db.select().from(schema.bookTitles).where(eq(schema.bookTitles.id, params.id)).limit(1);
  if (!title) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const concept = (title.concept ?? {}) as { angle?: string; outline?: string[] };
  try {
    const pages = await generateBookScript(
      { name: title.name, angle: concept.angle, outline: concept.outline },
      { pages: Number(b?.pages) || undefined, vars: Array.isArray(b?.vars) ? b.vars : undefined, model: b?.model ? String(b.model) : undefined },
    );
    await db.delete(schema.bookPages).where(eq(schema.bookPages.titleId, params.id));
    if (pages.length) {
      await db.insert(schema.bookPages).values(pages.map((p) => ({
        titleId: params.id, pageNo: p.page_no, textTemplate: p.text, illustrationBrief: p.illustration,
      })));
    }
    await db.update(schema.bookTitles).set({ status: "script", updatedAt: new Date() }).where(eq(schema.bookTitles.id, params.id));
    return NextResponse.json({ ok: true, pages });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 502 });
  }
}
