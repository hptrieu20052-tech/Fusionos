import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { orChatJSON } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/books/analyze-refs { images:[dataUrl], notes? } → { ok, analysis }
// Bước RIÊNG: xem ảnh listing đối thủ, trả tóm tắt NGẮN (text). Tách khỏi sinh ý tưởng để không chặn luồng.
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!(await can(s, "bookStudio"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
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

  // ===== CHẾ ĐỘ "STYLE": rút PHONG CÁCH VẼ từ ảnh mẫu → điền thẳng vào Style Bible =====
  if (b?.mode === "style") {
    const sysS = "You are an expert children's-book art director. Study the reference illustration(s) VERY carefully and describe the VISUAL STYLE precisely enough that another artist could reproduce it on new pages. Reply ONLY as JSON. Answer in ENGLISH.";
    const userS = `There are ${imgs.length} reference image(s) attached${b?.notes ? ` (context: ${b.notes})` : ""}. These may be PRODUCT MOCKUP PHOTOS (a printed book held by a child in a room). Analyze ONLY the printed ILLUSTRATION/artwork on the book cover or page — IGNORE the real photograph around it (the child, hands, room, blanket, camera lighting). Extract the shared DRAWING style of that artwork (ignore the specific subject/characters). Return EXACTLY this JSON — each value a concrete, reusable instruction, no vague adjectives alone:
{
  "artStyle": "medium + linework + shading + rendering + lighting (e.g. 'soft watercolor storybook painting, minimal or no outlines, gentle color washes, dreamy diffused light, subtle paper texture')",
  "palette": "3-6 dominant colors, comma separated",
  "textStyle": "the TITLE/typography look seen on the cover: font family kind (serif/script/rounded), color, outline/shadow, placement",
  "character": "how characters are drawn: proportions, face style, cuteness/realism level, eyes, cheeks",
  "mood": "overall mood/atmosphere in a few words",
  "summary": "1 short human-readable line naming the style"
}
Base every field ONLY on what you actually see. Do NOT nest objects; every value is a plain string.`;
    try {
      const out = await orChatJSON<Record<string, unknown>>(sysS, userS, { model, images: imgs, maxTokens: 700, temperature: 0.3 });
      const str = (v: unknown): string => typeof v === "string" ? v : v == null ? "" : (Array.isArray(v) ? v.map(str).join(", ") : Object.values(v as Record<string, unknown>).map(str).join(" · "));
      const style = {
        artStyle: str(out?.artStyle).slice(0, 600),
        palette: str(out?.palette).slice(0, 300),
        textStyle: str(out?.textStyle).slice(0, 400),
        character: str(out?.character).slice(0, 500),
        mood: str(out?.mood).slice(0, 200),
        summary: str(out?.summary).slice(0, 200),
      };
      return NextResponse.json({ ok: true, style, count: imgs.length });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 502 });
    }
  }

  const system = "Bạn là chuyên gia phân tích sản phẩm sách/quà personalized bán trên Etsy/TikTok. Nhìn KỸ ảnh listing đối thủ và mô tả CỤ THỂ những gì THẤY trong ảnh. Trả lời DUY NHẤT bằng JSON.";
  const user = `Bối cảnh sản phẩm đang làm: ${b?.notes || "(không)"}
Có ${imgs.length} ảnh listing đối thủ đính kèm. Trong trường "analysis", viết VĂN BẢN THƯỜNG tiếng Việt, dùng xuống dòng và gạch đầu dòng "-", gồm:
- Mỗi ảnh 1 dòng: chủ đề/ngách · nhân vật chính · phong cách vẽ · tông màu · chữ/tiêu đề nổi bật (nếu có) · bố cục.
- 1 dòng "Ngách chung:" + điểm mạnh của họ.
- 2-3 dòng "Gợi ý khác biệt:" cách làm nổi hơn.
Bám sát ĐÚNG nội dung ảnh, không bịa. QUAN TRỌNG: "analysis" là MỘT chuỗi văn bản dễ đọc, TUYỆT ĐỐI KHÔNG lồng JSON/object bên trong.
Trả JSON đúng dạng: {"analysis":"...(văn bản nhiều dòng)..."}`;
  try {
    const out = await orChatJSON<{ analysis?: unknown }>(system, user, { model, images: imgs, maxTokens: 700, temperature: 0.5 });
    // Ưu tiên chuỗi; nếu model lỡ trả object thì gỡ thành text dễ đọc thay vì JSON thô.
    const flatten = (v: unknown): string => {
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v.map(flatten).join("\n");
      if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, val]) => `- ${k}: ${flatten(val)}`).join("\n");
      return String(v ?? "");
    };
    const analysis = (typeof out?.analysis === "string" ? out.analysis : flatten(out?.analysis ?? out)).slice(0, 1800);
    return NextResponse.json({ ok: true, analysis, count: imgs.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 502 });
  }
}
