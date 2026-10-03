import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { orChatJSON } from "@/lib/ai/openrouter";
import { getPrompt } from "@/lib/ai/prompt-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ai-video/script — AI TỰ VIẾT KỊCH BẢN video từ ảnh sản phẩm (quyền "genVideo").
 * body { images:[dataURL|http] (tối đa 6), notes?, mode? }
 *   - mặc định: 1 kịch bản chung (1 ảnh = i2v; nhiều ảnh = multi-scene @Image1…) → { prompt, … }.
 *   - mode "clips" (v628 · multi-clip ghép nối): MỖI ẢNH 1 KỊCH BẢN RIÊNG — ảnh i thành clip i
 *     độc lập rồi nối lại theo thứ tự → { clips: [prompt1, prompt2, …], negativePrompt, … }.
 * Dùng OPENROUTER_API_KEY (model vision) — không gọi fal, không tốn phí render.
 *
 * v628 · CHỐNG 502 "Bad gateway": trước đây getPrompt() (đọc DB) nằm NGOÀI try và NGOÀI auth,
 * còn OpenRouter được chờ tới 50s — DB chậm + model chậm là vượt mốc 60s của Vercel, function bị
 * giết trước khi kịp trả JSON → client nhận trang HTML 502 của gateway ("fusiondn.com | 502: Bad
 * gateway"). Giờ: auth trước, getPrompt vào trong try, timeout OpenRouter hạ còn 40s — mọi nhánh
 * lỗi đều trả JSON tử tế. (Client v628 cũng tự retry 1 lần khi dính HTML gateway.)
 */

type Script = {
  idea?: string;
  prompt?: string;
  negative_prompt?: string;
  duration?: string;
  aspect_ratio?: string;
  clips?: ({ prompt?: string } | string)[];
};

// Prompt sống ở src/lib/ai/prompt-defs.ts (id "video.script") — admin sửa qua Manager Prompts.
// Khối dưới GHÉP THÊM vào system khi mode=clips (không cho admin ghi đè để JSON shape luôn đúng).
const CLIPS_RULES = `

MODE OVERRIDE — MULTI-CLIP STITCH: the attached photos will be rendered as SEPARATE image-to-video clips (clip i starts EXACTLY from photo i, ~5s each) and then stitched together in the given order. Ignore the multi-scene @Image instructions above. For EACH photo write ONE standalone motion prompt (30-70 words, English): clip 1 hooks the viewer, middle clips show the product and its personalization up close, the last clip closes with a warm selling beat. Never reference other photos or @ImageN and never describe a transition into another scene — each clip must stand alone, yet together they read as ONE ad. The printed design/text in each photo must stay sharp, readable and unchanged — say so in every clip prompt.
Return STRICT JSON:
{"idea":"<1 short sentence: the ad concept>",
 "clips":[{"prompt":"<for photo 1>"}, {"prompt":"<for photo 2>"}, ... one per photo, same order],
 "negative_prompt":"<comma-separated>",
 "aspect_ratio":"9:16" | "1:1" | "16:9"}`;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (!(await can(session, "genVideo"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const IMG_OK = (s: string) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(s) || /^https?:\/\/\S+$/i.test(s);
  const images: string[] = (Array.isArray(b?.images) ? b.images : [b?.image]).map((x: unknown) => String(x ?? "").trim()).filter(IMG_OK).slice(0, 6);
  const notes = String(b?.notes ?? "").trim().slice(0, 500);
  const mode = String(b?.mode ?? "") === "clips" ? "clips" : "single";
  if (!images.length) return NextResponse.json({ ok: false, error: "Source image required" }, { status: 400 });

  try {
    const SYSTEM = (await getPrompt("video.script")) + (mode === "clips" ? CLIPS_RULES : ""); // admin ghi đè phần gốc qua Manager Prompts
    const user = mode === "clips"
      ? `${images.length} product photos attached — each becomes its OWN ~5s clip, stitched in this order. ` +
        (notes ? `Ad idea / direction from the seller (follow it): ${notes}` : "Write the best-selling stitched ad.")
      : (images.length > 1 ? `${images.length} product photos attached, in order @Image1..@Image${images.length}. ` : "Product photo attached. ") +
        (notes ? `Extra direction from the seller (follow it): ${notes}` : "Write the best-selling ad script for it.");
    // 40s < maxDuration 60s (kể cả khi DB/getPrompt chậm) → model chậm vẫn kịp trả lỗi JSON tử tế
    // thay vì bị Vercel giết (client thấy trang HTML 502 của gateway).
    const s = await orChatJSON<Script>(SYSTEM, user, { images, maxTokens: mode === "clips" ? 2200 : 1000, temperature: 0.8, timeoutMs: 40000 });

    if (mode === "clips") {
      const arr = Array.isArray(s?.clips) ? s.clips : [];
      const clips = images.map((_, i) => {
        const c = arr[i];
        return String((typeof c === "string" ? c : c?.prompt) ?? "").trim();
      });
      if (!clips.some(Boolean)) throw new Error("AI không trả về kịch bản — thử lại.");
      return NextResponse.json({
        ok: true,
        idea: String(s?.idea ?? "").trim(),
        clips,
        negativePrompt: String(s?.negative_prompt ?? "").trim(),
        aspectRatio: ["9:16", "1:1", "16:9"].includes(String(s?.aspect_ratio)) ? String(s?.aspect_ratio) : "9:16",
      });
    }

    const prompt = String(s?.prompt ?? "").trim();
    if (!prompt) throw new Error("AI không trả về kịch bản — thử lại.");
    return NextResponse.json({
      ok: true,
      idea: String(s?.idea ?? "").trim(),
      prompt,
      negativePrompt: String(s?.negative_prompt ?? "").trim(),
      duration: String(s?.duration) === "5" ? "5" : "10",
      aspectRatio: ["9:16", "1:1", "16:9"].includes(String(s?.aspect_ratio)) ? String(s?.aspect_ratio) : "9:16",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 502 });
  }
}
