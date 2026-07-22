import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { orGenerateImage } from "@/lib/ai/openrouter";
import { writeFile, fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/ai-image/generate — 3 chức năng Gen Image (AI Agent). Quyền: module "genImage".
 *  body { mode: "clone" | "bgremove" | "redesign", image: <dataURL ảnh nguồn>, prompt?, aspectRatio? }
 *   - clone    : chép lại ảnh gần như y hệt (tái tạo design sắc nét)
 *   - bgremove : tách nền → PNG nền trong suốt
 *   - redesign : thiết kế lại theo yêu cầu (prompt bắt buộc)
 * Gọi OpenRouter (Gemini Flash Image), lưu kết quả R2, trả link + chi phí.
 */
const MODE_PROMPT: Record<string, (p: string) => string> = {
  clone: () =>
    "Recreate the attached print/design image as an EXACT, clean, high-resolution copy. " +
    "Keep the composition, subject(s), colours, art style, typography and layout IDENTICAL — " +
    "do not add, remove, move or restyle anything. Output a crisp, print-ready reproduction.",
  bgremove: () =>
    "Cut out the MAIN SUBJECT of the attached image and remove the background completely. " +
    "Output a PNG with a FULLY TRANSPARENT background (real alpha channel) — no white fill, " +
    "no drawn checkerboard, no new background of any kind. Keep the subject's original colours, " +
    "fine details and clean anti-aliased edges. Do not crop or resize the subject.",
  redesign: (p: string) =>
    `Redesign the attached print artwork according to these instructions, keeping it a clean, ` +
    `high-resolution, print-ready design with good legibility:\n\n${p}\n\n` +
    `Keep anything not mentioned close to the original.`,
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (!(await can(session, "genImage"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const mode = String(b?.mode ?? "");
  const image = String(b?.image ?? "");
  const prompt = String(b?.prompt ?? "").trim();
  if (!MODE_PROMPT[mode]) return NextResponse.json({ ok: false, error: "invalid mode" }, { status: 400 });
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(image)) return NextResponse.json({ ok: false, error: "Cần tải lên 1 ảnh nguồn" }, { status: 400 });
  if (mode === "redesign" && !prompt) return NextResponse.json({ ok: false, error: "Redesign cần nhập yêu cầu thiết kế lại" }, { status: 400 });

  const fullPrompt = MODE_PROMPT[mode](prompt);
  try {
    const img = await orGenerateImage(fullPrompt, [image], {
      outputFormat: "png",
      ...(b?.aspectRatio ? { aspectRatio: String(b.aspectRatio) } : {}),
    });
    const buf = Buffer.from(img.b64, "base64");
    const key = `ai-image/${mode}-${session.sub}-${Date.now()}.png`;
    await writeFile(key, buf, img.mediaType || "image/png");
    return NextResponse.json({ ok: true, url: fileUrl(key), dataUrl: `data:${img.mediaType || "image/png"};base64,${img.b64}`, cost: img.cost });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 });
  }
}
