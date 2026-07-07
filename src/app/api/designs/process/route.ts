import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { processFile } from "@/lib/process-image";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { fileId } — xử lý ngay 1 file (dùng khi vừa upload, để có thumbnail nhanh).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b?.fileId) return NextResponse.json({ ok: false, error: "fileId required" }, { status: 400 });

  const r = await processFile(String(b.fileId));
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
