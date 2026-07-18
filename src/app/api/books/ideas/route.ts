import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { generateBookIdeas } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/books/ideas { occasion, audience, pages, notes, count } → { ok, ideas } (KHÔNG lưu).
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  try {
    // Ảnh tham khảo đối thủ (data URL) → THU NHỎ 768px cho nhẹ + đỡ tốn token vision. Tối đa 3 ảnh.
    const rawRefs = Array.isArray(b?.refImages) ? (b.refImages as string[]).filter((s) => typeof s === "string" && s.startsWith("data:")).slice(0, 3) : [];
    const refImages: string[] = [];
    if (rawRefs.length) {
      const sharp = (await import("sharp")).default;
      for (const u of rawRefs) {
        try {
          const base64 = u.split(",")[1] ?? "";
          const buf = Buffer.from(base64, "base64");
          const small = await sharp(buf).rotate().resize(768, 768, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
          refImages.push(`data:image/jpeg;base64,${small.toString("base64")}`);
        } catch { refImages.push(u); /* thu nhỏ lỗi → dùng ảnh gốc */ }
      }
    }
    const ideas = await generateBookIdeas({
      occasion: b?.occasion ? String(b.occasion) : undefined,
      audience: b?.audience ? String(b.audience) : undefined,
      pages: Number(b?.pages) || undefined,
      notes: b?.notes ? String(b.notes) : undefined,
      count: Number(b?.count) || undefined,
      model: b?.model ? String(b.model) : undefined,
      refImages,
    });
    return NextResponse.json({ ok: true, ideas });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 502 });
  }
}
