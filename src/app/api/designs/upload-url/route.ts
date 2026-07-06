import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getUploadTarget } from "@/lib/storage";

export const dynamic = "force-dynamic";

// POST { designId, filename, kind, contentType } → { url, method, key }
// Bước 1 của flow upload: server chỉ cấp URL, file KHÔNG đi qua server (với R2).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b?.designId || !b?.filename || !schema.designFiles.kind.enumValues.includes(b.kind)) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const [d] = await db.select({ id: schema.designs.id }).from(schema.designs).where(eq(schema.designs.id, b.designId)).limit(1);
  if (!d) return NextResponse.json({ ok: false, error: "design not found" }, { status: 404 });

  const safe = String(b.filename).replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const key = `designs/${b.designId}/${b.kind}-${Date.now()}-${safe}`;
  const target = await getUploadTarget(key, b.contentType ?? "application/octet-stream");
  return NextResponse.json({ ok: true, key, ...target });
}
