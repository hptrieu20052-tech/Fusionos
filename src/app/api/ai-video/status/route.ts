import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { falVideoPoll } from "@/lib/ai/fal";
import { writeFile, fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ai-video/status — hỏi trạng thái job video.
 * body { statusUrl, responseUrl } (do /generate trả về).
 * Chưa xong → { done:false, status }. Xong → tải mp4 về lưu R2, trả { done:true, url }.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (!(await can(session, "genVideo"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const statusUrl = String(b?.statusUrl ?? "").trim();
  const responseUrl = String(b?.responseUrl ?? "").trim();
  if (!statusUrl || !responseUrl) return NextResponse.json({ ok: false, error: "missing job urls" }, { status: 400 });

  try {
    const { status, videoUrl } = await falVideoPoll(statusUrl, responseUrl);
    if (status !== "COMPLETED" || !videoUrl) return NextResponse.json({ ok: true, done: false, status });

    // Tải video kết quả về lưu R2 (link fal chỉ sống tạm thời).
    const r = await fetch(videoUrl, { signal: AbortSignal.timeout(45000) });
    if (!r.ok) return NextResponse.json({ ok: true, done: true, url: videoUrl, stored: false });
    const buf = Buffer.from(await r.arrayBuffer());
    const key = `ai-video/${session.sub}-${Date.now()}.mp4`;
    try {
      await writeFile(key, buf, "video/mp4");
      return NextResponse.json({ ok: true, done: true, url: fileUrl(key), size: buf.length, stored: true });
    } catch {
      // Lưu R2 lỗi → trả thẳng link fal để không mất kết quả.
      return NextResponse.json({ ok: true, done: true, url: videoUrl, stored: false });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 502 });
  }
}
