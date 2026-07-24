import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { falVideoSubmit, isVideoModel, VIDEO_MODELS } from "@/lib/ai/fal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ai-video/generate — Gen Video (image-to-video). Quyền: module "genVideo".
 * body { image:<dataURL|http>, prompt?, model, duration:"5"|"10", aspectRatio? }
 * Render lâu → chỉ SUBMIT job vào queue fal, trả { requestId, statusUrl, responseUrl }.
 * Client tự gọi /api/ai-video/status để hỏi tới khi xong.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (!(await can(session, "genVideo"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const image = String(b?.image ?? "").trim();
  const prompt = String(b?.prompt ?? "").trim();
  const duration = String(b?.duration ?? "5") === "10" ? "10" : "5";
  const aspectRatio = b?.aspectRatio && b.aspectRatio !== "auto" ? String(b.aspectRatio) : undefined;
  const model = String(b?.model ?? "").trim() || VIDEO_MODELS[0].id;

  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(image) && !/^https?:\/\/\S+$/i.test(image))
    return NextResponse.json({ ok: false, error: "Source image required (upload or paste an http link)" }, { status: 400 });
  if (!isVideoModel(model)) return NextResponse.json({ ok: false, error: "Invalid video model" }, { status: 400 });

  try {
    const { requestId, statusUrl, responseUrl } = await falVideoSubmit(model, { prompt, imageUrl: image, duration, aspectRatio });
    return NextResponse.json({ ok: true, requestId, statusUrl, responseUrl, model });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 502 });
  }
}
