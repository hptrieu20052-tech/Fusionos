import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { orChatJSON } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ai-video/script — AI TỰ VIẾT KỊCH BẢN video từ ảnh sản phẩm (quyền "genVideo").
 * body { image:<dataURL|http>, notes?, model? ("kling"|"seedance" hint), duration? }
 * → { prompt, negativePrompt, duration, aspectRatio, idea } — đổ thẳng vào form Gen Video.
 * Dùng OPENROUTER_API_KEY (model vision) — không gọi fal, không tốn phí render.
 */

type Script = {
  idea?: string;
  prompt?: string;
  negative_prompt?: string;
  duration?: string;
  aspect_ratio?: string;
};

const SYSTEM = `You are a senior video ad director for print-on-demand (POD) products sold on Etsy and TikTok.
You will receive ONE OR MORE product photos (t-shirt, sweatshirt, mug, poster...).

If ONE photo: write a script for an IMAGE-TO-VIDEO model (Kling / Seedance) — the video starts EXACTLY from this photo, so describe motion that evolves naturally from it.
If SEVERAL photos: write a MULTI-SCENE script for Seedance reference-to-video. Refer to the photos as @Image1, @Image2, ... in the order given. One scene per image, chronological, with a smooth transition between scenes (match cut, whip pan, or natural movement — never a hard teleport). Still one flowing paragraph.

Rules for the motion prompt:
- UGC-style ad that sells: a believable human moment, not a static zoom. Think: model smiles and turns slightly, tugs the shirt to show the print, camera slowly pushes in on the design, then pulls back; light handheld feel.
- 2–3 beats max within the duration (e.g. 0-3s..., 3-6s..., 6-10s...). Write them as one flowing paragraph, chronological.
- CRITICAL: the printed design, all text and logos must stay EXACTLY as in the photo — sharp, readable, undistorted. Say this explicitly.
- Keep hands, face and body natural. No new objects, no scene change, no cuts to a different location.
- English only. 60–120 words.

Also write a negative prompt (comma-separated, English): the specific artifacts to avoid for THIS image (warped/illegible text on the print, deformed logo, extra fingers, morphing face, flicker, watermark, subtitles, heavy camera shake, scene change...).

Return STRICT JSON:
{"idea": "<1 short sentence: the ad concept>",
 "prompt": "<the motion prompt>",
 "negative_prompt": "<comma-separated>",
 "duration": "5" or "10",
 "aspect_ratio": "9:16" | "1:1" | "16:9"}
Prefer duration "10" and aspect_ratio "9:16" (TikTok) unless the image clearly suits something else.`;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (!(await can(session, "genVideo"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const IMG_OK = (s: string) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(s) || /^https?:\/\/\S+$/i.test(s);
  const images: string[] = (Array.isArray(b?.images) ? b.images : [b?.image]).map((x: unknown) => String(x ?? "").trim()).filter(IMG_OK).slice(0, 4);
  const notes = String(b?.notes ?? "").trim().slice(0, 500);
  if (!images.length) return NextResponse.json({ ok: false, error: "Source image required" }, { status: 400 });

  try {
    const multi = images.length > 1 ? `${images.length} product photos attached, in order @Image1..@Image${images.length}. ` : "Product photo attached. ";
    const user = multi + (notes
      ? `Extra direction from the seller (follow it): ${notes}`
      : "Write the best-selling ad script for it.");
    // 50s < maxDuration 60s → nếu model chậm vẫn kịp trả lỗi JSON tử tế thay vì bị Vercel giết (client thấy "Network error").
    const s = await orChatJSON<Script>(SYSTEM, user, { images, maxTokens: 1000, temperature: 0.8, timeoutMs: 50000 });
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
