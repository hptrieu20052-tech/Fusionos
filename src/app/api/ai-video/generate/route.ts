import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { falVideoSubmit, isVideoModel, VIDEO_MODELS } from "@/lib/ai/fal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ai-video/generate — Gen Video (image-to-video). Quyền: module "genVideo".
 * body { image:<dataURL|http>, images?:string[] (multi-scene, tối đa 4), prompt?, model, duration:"5"|"10", aspectRatio? }
 * Render lâu → chỉ SUBMIT job vào queue fal, trả { requestId, statusUrl, responseUrl }.
 * Client tự gọi /api/ai-video/status để hỏi tới khi xong.
 */
const IMG_OK = (s: string) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(s) || /^https?:\/\/\S+$/i.test(s);

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (!(await can(session, "genVideo"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  // Nhiều ảnh (multi-scene) → mảng images; giữ image (ảnh đầu) để tương thích cũ.
  const images: string[] = (Array.isArray(b?.images) ? b.images : []).map((x: unknown) => String(x ?? "").trim()).filter(IMG_OK).slice(0, 4);
  const image = String(b?.image ?? "").trim() || images[0] || "";
  const prompt = String(b?.prompt ?? "").trim();
  const negativePrompt = String(b?.negativePrompt ?? "").trim().slice(0, 600);
  const duration = String(b?.duration ?? "5") === "10" ? "10" : "5";
  const aspectRatio = b?.aspectRatio && b.aspectRatio !== "auto" ? String(b.aspectRatio) : undefined;
  const resolution = String(b?.resolution ?? "") === "1080p" ? "1080p" : undefined;
  const model = String(b?.model ?? "").trim() || VIDEO_MODELS[0].id;

  if (!IMG_OK(image))
    return NextResponse.json({ ok: false, error: "Source image required (upload or paste an http link)" }, { status: 400 });
  if (!isVideoModel(model)) return NextResponse.json({ ok: false, error: "Invalid video model" }, { status: 400 });
  // Nhiều ảnh nhưng chọn model 1-ảnh → báo rõ thay vì lặng lẽ bỏ ảnh thừa.
  if (images.length > 1 && !model.includes("reference-to-video"))
    return NextResponse.json({ ok: false, error: "Multiple images need the Multi-image model (Seedance 2.0 Multi-image — scenes)" }, { status: 400 });

  try {
    const { requestId, statusUrl, responseUrl } = await falVideoSubmit(model, { prompt, imageUrl: image, imageUrls: images, duration, aspectRatio, negativePrompt, resolution });
    return NextResponse.json({ ok: true, requestId, statusUrl, responseUrl, model });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 502 });
  }
}
