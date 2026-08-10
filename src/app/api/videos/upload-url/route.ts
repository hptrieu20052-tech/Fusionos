import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getUploadTarget, fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * v207 · POST /api/videos/upload-url { filename, contentType, kind? }
 *   → { url, method, key, publicUrl }
 *
 * File bay THẲNG browser → R2, không qua Vercel: video 30–100MB đi qua hàm là dính giới hạn
 * body 4.5MB ngay. Server chỉ ký một URL có hạn 10 phút.
 *
 * publicUrl BẮT BUỘC phải công khai: Shopify (staged upload đọc lại), Meta và TikTok đều tự tải
 * video về từ URL này. R2_PUBLIC_URL chưa cấu hình thì chặn sớm cho biết lý do, đừng để upload
 * xong mới hỏng ở bước đẩy đi.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "videos")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const rawName = String((b as { filename?: string })?.filename ?? "").trim();
  const ct = String((b as { contentType?: string })?.contentType ?? "").trim() || "video/mp4";
  const kind = String((b as { kind?: string })?.kind ?? "video") === "thumb" ? "thumb" : "video";

  if (kind === "video" && !/^video\//i.test(ct)) {
    return NextResponse.json({ ok: false, error: "contentType must be video/*" }, { status: 400 });
  }
  if (kind === "thumb" && !/^image\//i.test(ct)) {
    return NextResponse.json({ ok: false, error: "thumbnail contentType must be image/*" }, { status: 400 });
  }

  // Tên file do client đặt — không tin thẳng, chỉ giữ ký tự an toàn cho key.
  const safe = rawName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(-90)
    || (kind === "thumb" ? "poster.jpg" : "clip.mp4");
  // Rải theo tháng để bucket không phình một thư mục khổng lồ.
  const stamp = new Date().toISOString().slice(0, 7); // YYYY-MM
  const key = `videos/${stamp}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;

  const publicUrl = fileUrl(key);
  if (!publicUrl || publicUrl.startsWith("/")) {
    return NextResponse.json(
      { ok: false, error: "R2_PUBLIC_URL is not configured. Shopify, Meta and TikTok all need to fetch the video from a public URL — set R2_PUBLIC_URL first." },
      { status: 500 },
    );
  }

  const target = await getUploadTarget(key, ct);
  return NextResponse.json({ ok: true, key, publicUrl, url: target.url, method: target.method });
}
