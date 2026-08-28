import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { orChatJSON } from "@/lib/ai/openrouter";
import { getPrompt } from "@/lib/ai/prompt-store";

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

// Prompt sống ở src/lib/ai/prompt-defs.ts (id "video.script") — admin sửa qua Manager Prompts.

export async function POST(req: NextRequest) {
  const SYSTEM = await getPrompt("video.script"); // admin ghi đè qua Manager Prompts
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
