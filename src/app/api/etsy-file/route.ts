import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/etsy-file?url=<i.etsystatic.com ipf url>&name=<filename>
// Proxy TẢI ảnh khách upload (CDN Etsy public) → stream về dạng attachment để 1 chạm là tải đúng tên file.
// Chặn SSRF: chỉ cho phép host i.etsystatic.com.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const raw = sp.get("url") ?? "";
  if (!/^https:\/\/i\.etsystatic\.com\//i.test(raw)) return NextResponse.json({ ok: false, error: "invalid url" }, { status: 400 });
  // Luôn tải bản gốc fullxfull (dù link truyền vào là thumbnail).
  const url = raw.replace(/ipf_\d+x\d+/i, "ipf_fullxfull");
  // Dọn tên: bỏ dung lượng dính đuôi + đảm bảo có đuôi ảnh.
  let name = (sp.get("name") || "").replace(/[\r\n"]/g, "").replace(/\s*\d+(\.\d+)?\s*(kb|mb|gb)\s*$/i, "").trim();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return NextResponse.json({ ok: false, error: `upstream ${r.status}` }, { status: 502 });
    const ct = r.headers.get("content-type") ?? "image/jpeg";
    if (!/\.(jpe?g|png|webp|gif|heic|heif|pdf)$/i.test(name)) {
      const ext = /png/i.test(ct) ? "png" : /webp/i.test(ct) ? "webp" : /gif/i.test(ct) ? "gif" : /pdf/i.test(ct) ? "pdf" : "jpg";
      name = (name || (url.split("?")[0].split("/").pop() || "photo")).replace(/\.[^.]*$/, "") + "." + ext;
    }
    name = name.slice(0, 150);
    const buf = await r.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": ct,
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
