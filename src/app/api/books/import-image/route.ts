import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Lấy URL ảnh chính từ HTML: ưu tiên og:image / twitter:image / link image_src, cuối cùng là <img> đầu tiên.
function pickImageUrl(html: string, base: string): string {
  const meta = (key: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
    const m = html.match(re);
    if (!m) return "";
    const c = m[0].match(/content=["']([^"']+)["']/i);
    return c ? c[1] : "";
  };
  let u = meta("og:image:secure_url") || meta("og:image") || meta("twitter:image") || meta("twitter:image:src");
  if (!u) { const l = html.match(/<link[^>]+rel=["']image_src["'][^>]*>/i); if (l) { const h = l[0].match(/href=["']([^"']+)["']/i); if (h) u = h[1]; } }
  if (!u) { const i = html.match(/<img[^>]+src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i); if (i) u = i[1]; }
  if (!u) return "";
  u = u.replace(/&amp;/g, "&").trim();
  try { return new URL(u, base).href; } catch { return u; }
}

// POST /api/books/import-image { url } → { ok, dataUrl } : lấy ảnh từ link listing (Etsy/Amazon/web) hoặc link ảnh trực tiếp.
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  let url = String(b?.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) return NextResponse.json({ ok: false, error: "Link không hợp lệ" }, { status: 400 });

  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,image/*,*/*" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (!res.ok) return NextResponse.json({ ok: false, error: `Tải trang lỗi HTTP ${res.status}` }, { status: 502 });
    const ct = (res.headers.get("content-type") || "").toLowerCase();

    const isVideo = (u: string) => /\.(mp4|webm|mov|m4v|avi|mkv)(\?|#|$)/i.test(u);
    let imgBuf: Buffer | null = null;
    if (ct.startsWith("image/")) {
      imgBuf = Buffer.from(await res.arrayBuffer());
    } else if (ct.startsWith("video/")) {
      return NextResponse.json({ ok: false, error: "Link là video — cần link ảnh/listing có ảnh." }, { status: 400 });
    } else {
      const html = await res.text();
      const imgUrl = pickImageUrl(html, url);
      // Loại video: listing (Etsy…) có thể có video → chỉ lấy ẢNH.
      if (!imgUrl || isVideo(imgUrl)) return NextResponse.json({ ok: false, error: "Không tìm thấy ẢNH trong link (bỏ qua video). Thử link ảnh trực tiếp." }, { status: 404 });
      const ir = await fetch(imgUrl, { headers: { "User-Agent": UA, "Referer": url, "Accept": "image/*,*/*" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
      if (!ir.ok) return NextResponse.json({ ok: false, error: `Tải ảnh lỗi HTTP ${ir.status}` }, { status: 502 });
      if ((ir.headers.get("content-type") || "").toLowerCase().startsWith("video/")) return NextResponse.json({ ok: false, error: "Nội dung lấy được là video, không phải ảnh." }, { status: 400 });
      imgBuf = Buffer.from(await ir.arrayBuffer());
    }
    if (!imgBuf || imgBuf.length < 100) return NextResponse.json({ ok: false, error: "Ảnh rỗng" }, { status: 502 });
    if (imgBuf.length > 20 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Ảnh quá lớn (>20MB)" }, { status: 413 });

    // Thu nhỏ 768px cho nhẹ + đỡ token vision.
    let out = imgBuf;
    try {
      const sharp = (await import("sharp")).default;
      out = await sharp(imgBuf).rotate().resize(768, 768, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    } catch { /* lỗi resize → dùng ảnh gốc */ }
    return NextResponse.json({ ok: true, dataUrl: `data:image/jpeg;base64,${out.toString("base64")}` });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    return NextResponse.json({ ok: false, error: /timeout|abort/i.test(msg) ? "Hết giờ tải link (trang chặn bot?)" : msg.slice(0, 200) }, { status: 502 });
  }
}
