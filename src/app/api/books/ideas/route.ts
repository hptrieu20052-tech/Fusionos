import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { generateBookIdeas } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/books/ideas { occasion, audience, pages, notes, count } → { ok, ideas } (KHÔNG lưu).
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!(await can(s, "bookStudio"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  try {
    // Text-only: ảnh đối thủ đã được phân tích ở /analyze-refs, kết quả (text) truyền qua `competitor`.
    const ideas = await generateBookIdeas({
      occasion: b?.occasion ? String(b.occasion) : undefined,
      audience: b?.audience ? String(b.audience) : undefined,
      pages: Number(b?.pages) || undefined,
      notes: b?.notes ? String(b.notes) : undefined,
      count: Number(b?.count) || undefined,
      model: b?.model ? String(b.model) : undefined,
      competitor: b?.competitor ? String(b.competitor) : undefined,
    });
    return NextResponse.json({ ok: true, ideas });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 502 });
  }
}
