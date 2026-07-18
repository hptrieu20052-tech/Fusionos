import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { orChatJSON } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/books/analyze-refs { images:[dataUrl], notes? } → { ok, analysis }
// Bước RIÊNG: xem ảnh listing đối thủ, trả tóm tắt NGẮN (text). Tách khỏi sinh ý tưởng để không chặn luồng.
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const raw = Array.isArray(b?.images) ? (b.images as string[]).filter((x) => typeof x === "string" && x.startsWith("data:")).slice(0, 4) : [];
  if (!raw.length) return NextResponse.json({ ok: false, error: "no images" }, { status: 400 });

  // Nén server-side 448px (phòng ảnh chưa nén) → nhẹ, nhanh.
  const imgs: string[] = [];
  try {
    const sharp = (await import("sharp")).default;
    for (const u of raw) {
      try {
        const buf = Buffer.from((u.split(",")[1] || ""), "base64");
        const small = await sharp(buf).rotate().resize(448, 448, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
        imgs.push(`data:image/jpeg;base64,${small.toString("base64")}`);
      } catch { imgs.push(u); }
    }
  } catch { imgs.push(...raw); }

  const model = process.env.OPENROUTER_VISION_MODEL || "openai/gpt-4o-mini";
  const system = "Bạn là chuyên gia phân tích sản phẩm sách/quà personalized bán trên Etsy/TikTok. Nhìn KỸ ảnh listing đối thủ và mô tả CỤ THỂ những gì THẤY trong ảnh. Trả lời DUY NHẤT bằng JSON.";
  const user = `Bối cảnh sản phẩm đang làm: ${b?.notes || "(không)"}
Có ${imgs.length} ảnh listing đối thủ đính kèm. Hãy:
1) Với TỪNG ảnh, mô tả 1 dòng: chủ đề/ngách, nhân vật chính, phong cách vẽ, tông màu, chữ/tiêu đề nổi bật nếu có, bố cục.
2) Rút ra ngách chung + điểm mạnh của họ.
3) 2-3 gạch đầu dòng gợi ý cách LÀM KHÁC BIỆT.
Bám sát ĐÚNG nội dung ảnh, không bịa. Trả JSON: {"analysis":"..."}`;
  try {
    const out = await orChatJSON<{ analysis: string }>(system, user, { model, images: imgs, maxTokens: 700, temperature: 0.5 });
    return NextResponse.json({ ok: true, analysis: String(out?.analysis || "").slice(0, 1500), count: imgs.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 502 });
  }
}
