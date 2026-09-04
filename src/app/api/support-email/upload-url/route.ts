import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getUploadTarget } from "@/lib/storage";

export const dynamic = "force-dynamic";

// POST /api/support-email/upload-url { filename, contentType, size } → presigned PUT
// File đính kèm khi REPLY: client upload thẳng lên storage (không đi qua function → không dính giới hạn body).
// Key nằm trong prefix support-email/outgoing/ — /api/support-email/reply chỉ chấp nhận key prefix này.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.role !== "admin" && session.role !== "support") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if ((await levelOf(session, "support")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const size = Number(b?.size ?? 0);
  if (!size || size > 10 * 1024 * 1024) return NextResponse.json({ ok: false, error: "max 10MB per file" }, { status: 400 });
  const ct = String(b?.contentType ?? "application/octet-stream");
  const name = String(b?.filename ?? "file").replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "file";
  const key = `support-email/outgoing/${session.sub}-${Date.now()}-${name}`;
  const target = await getUploadTarget(key, ct);
  return NextResponse.json({ ok: true, key, ...target });
}
