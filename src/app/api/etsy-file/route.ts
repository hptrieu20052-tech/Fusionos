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
  const url = sp.get("url") ?? "";
  const name = (sp.get("name") || "photo.jpg").replace(/[\r\n"]/g, "").slice(0, 150);
  if (!/^https:\/\/i\.etsystatic\.com\//i.test(url)) return NextResponse.json({ ok: false, error: "invalid url" }, { status: 400 });
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return NextResponse.json({ ok: false, error: `upstream ${r.status}` }, { status: 502 });
    const buf = await r.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": r.headers.get("content-type") ?? "image/jpeg",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
