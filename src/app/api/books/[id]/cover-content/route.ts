import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { generateBookCover } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/books/[id]/cover-content { model?, force? } → AI sinh { text, brief } cho BÌA, lưu vào title.cover (giữ prompt cũ).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const [title] = await db.select().from(schema.bookTitles).where(eq(schema.bookTitles.id, params.id)).limit(1);
  if (!title) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const cover = (title.cover ?? {}) as { text?: string; brief?: string; prompt?: string };
  // Không ghi đè nếu seller đã tự nhập (trừ khi force).
  if (!b?.force && (cover.text ?? "").trim() && (cover.brief ?? "").trim()) {
    return NextResponse.json({ ok: true, text: cover.text, brief: cover.brief, skipped: true });
  }
  const concept = (title.concept ?? {}) as { angle?: string };
  const brief = (title.brief ?? {}) as { notes?: string };
  const bible = (title.bible ?? {}) as { artStyle?: string; palette?: string };
  try {
    const gen = await generateBookCover(
      { name: title.name, occasion: title.occasion ?? undefined, audience: title.audience ?? undefined, angle: concept.angle, notes: brief.notes },
      bible,
      { model: b?.model ? String(b.model) : undefined },
    );
    const next = { ...cover, text: gen.text || cover.text || title.name, brief: gen.brief || cover.brief || "" };
    await db.update(schema.bookTitles).set({ cover: next, updatedAt: new Date() }).where(eq(schema.bookTitles.id, params.id));
    return NextResponse.json({ ok: true, text: next.text, brief: next.brief });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}
