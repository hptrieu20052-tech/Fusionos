import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getUploadTarget } from "@/lib/storage";

export const dynamic = "force-dynamic";

// POST /api/fulfillers/logo-url { filename, contentType } → presigned PUT + key (upload favicon supplier).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ct = String(b?.contentType ?? "");
  if (!ct.startsWith("image/")) return NextResponse.json({ ok: false, error: "Image files only" }, { status: 400 });
  const ext = (String(b?.filename ?? "").match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ".png").toLowerCase();
  const key = `suppliers/logo-${Date.now()}${ext}`;
  const target = await getUploadTarget(key, ct);
  return NextResponse.json({ ok: true, key, ...target });
}
