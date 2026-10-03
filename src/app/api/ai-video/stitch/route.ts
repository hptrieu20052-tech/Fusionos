import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { falMergeSubmit } from "@/lib/ai/fal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * v628 · POST /api/ai-video/stitch — NỐI nhiều clip đã render thành 1 video (fal ffmpeg merge-videos).
 * body { urls: string[] } — 2–8 link https của các clip, ĐÚNG THỨ TỰ (thường là link R2 mà
 * /api/ai-video/status đã lưu sau khi từng clip render xong).
 * Chỉ SUBMIT job vào queue fal rồi trả { requestId, statusUrl, responseUrl } — client poll tiếp
 * bằng /api/ai-video/status (kết quả merge cũng có dạng { video: { url } } nên poll dùng chung,
 * và video nối xong cũng được tải về lưu R2 y như clip thường).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (!(await can(session, "genVideo"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const urls: string[] = (Array.isArray(b?.urls) ? b.urls : [])
    .map((u: unknown) => String(u ?? "").trim())
    .filter((u: string) => /^https:\/\/\S+$/i.test(u) && u.length < 2048)
    .slice(0, 8);
  if (urls.length < 2) return NextResponse.json({ ok: false, error: "Need at least 2 clip URLs to stitch" }, { status: 400 });

  try {
    const r = await falMergeSubmit(urls);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 502 });
  }
}
