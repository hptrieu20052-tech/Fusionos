import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUploadTarget, fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

// POST /api/books/[id]/reference-url { filename, contentType } → presigned PUT target + key (upload ảnh reference nhân vật).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const ct = String(b?.contentType || "image/png");
  const ext = (ct.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
  const key = `book-refs/${params.id}-${Date.now()}.${ext}`;
  const target = await getUploadTarget(key, ct);
  return NextResponse.json({ ok: true, url: target.url, method: target.method, key, publicUrl: fileUrl(key) });
}
