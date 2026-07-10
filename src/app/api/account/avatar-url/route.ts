import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUploadTarget } from "@/lib/storage";

export const dynamic = "force-dynamic";

// POST /api/account/avatar-url { filename, contentType } → presigned PUT + key
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => null);
  const ct = String(b?.contentType ?? "");
  if (!ct.startsWith("image/")) return NextResponse.json({ ok: false, error: "Image files only" }, { status: 400 });
  const ext = (String(b?.filename ?? "").match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ".png").toLowerCase();
  const key = `avatars/${session.sub}-${Date.now()}${ext}`;
  const target = await getUploadTarget(key, ct);
  return NextResponse.json({ ok: true, key, storageKey: key, ...target });
}
