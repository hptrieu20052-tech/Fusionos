// Dev-only: nhận PUT file khi không có R2. Production dùng presigned URL → R2 trực tiếp.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { writeFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const key = req.nextUrl.searchParams.get("key");
  if (!key || key.includes("..")) return NextResponse.json({ ok: false, error: "bad key" }, { status: 400 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > 200 * 1024 * 1024) return NextResponse.json({ ok: false, error: "max 200MB" }, { status: 413 });
  await writeFile(key, buf, req.headers.get("content-type") ?? "application/octet-stream");
  return NextResponse.json({ ok: true, key, size: buf.length });
}
