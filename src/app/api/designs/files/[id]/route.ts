import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// DELETE /api/designs/files/[id] — xoá 1 file khỏi design (bản ghi DB; file storage giữ lại vì có thể dedup dùng chung)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const [f] = await db.select().from(schema.designFiles).where(eq(schema.designFiles.id, params.id)).limit(1);
  if (!f) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  await db.delete(schema.designFiles).where(eq(schema.designFiles.id, params.id));
  return NextResponse.json({ ok: true });
}
