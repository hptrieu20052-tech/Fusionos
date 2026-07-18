import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { generateBookSetup } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/books/[id]/setup { model? }
// AI TỰ DỰNG Style Bible + bộ biến theo CHỦ ĐỀ của đầu sách, lưu vào book_titles. Không đụng kịch bản.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const [title] = await db.select().from(schema.bookTitles).where(eq(schema.bookTitles.id, params.id)).limit(1);
  if (!title) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const concept = (title.concept ?? {}) as { angle?: string };
  const brief = (title.brief ?? {}) as { notes?: string };
  try {
    const setup = await generateBookSetup(
      { name: title.name, occasion: title.occasion ?? undefined, audience: title.audience ?? undefined, angle: concept.angle, notes: brief.notes },
      { model: b?.model ? String(b.model) : undefined },
    );
    // Giữ lại value cũ nếu biến trùng key (không xoá dữ liệu bạn đã điền).
    const oldVars = Array.isArray(title.vars) ? (title.vars as { key: string; value?: string }[]) : [];
    const vars = setup.vars.map((v) => ({ ...v, value: oldVars.find((o) => o.key === v.key)?.value ?? "" }));
    await db.update(schema.bookTitles).set({ bible: setup.bible, vars, updatedAt: new Date() }).where(eq(schema.bookTitles.id, params.id));
    return NextResponse.json({ ok: true, bible: setup.bible, vars });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 502 });
  }
}
