import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";

export const dynamic = "force-dynamic";

// PATCH /api/support-email/accounts/[id] — sửa hộp thư (ADMIN).
// Gửi field nào sửa field đó; "pass" chỉ ghi đè khi KHÁC rỗng (đổi mật khẩu).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const patch: Partial<typeof schema.supportEmailAccounts.$inferInsert> = {};
  if (typeof b?.label === "string" && b.label.trim()) patch.label = b.label.trim();
  if (typeof b?.fromName === "string") patch.fromName = b.fromName.trim() || null;
  if (typeof b?.imapHost === "string" && b.imapHost.trim()) patch.imapHost = b.imapHost.trim();
  if (b?.imapPort != null && Number(b.imapPort)) patch.imapPort = Number(b.imapPort);
  if (typeof b?.smtpHost === "string" && b.smtpHost.trim()) patch.smtpHost = b.smtpHost.trim();
  if (b?.smtpPort != null && Number(b.smtpPort)) patch.smtpPort = Number(b.smtpPort);
  if (typeof b?.active === "boolean") patch.active = b.active;
  if (typeof b?.pass === "string" && b.pass) { patch.passEnc = encryptSecret(b.pass); patch.lastSyncError = null; }
  if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: "không có gì để sửa" }, { status: 400 });

  const rows = await db.update(schema.supportEmailAccounts).set(patch)
    .where(eq(schema.supportEmailAccounts.id, params.id)).returning({ id: schema.supportEmailAccounts.id });
  if (!rows.length) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/support-email/accounts/[id] — xoá hộp thư (ADMIN).
// Có thread rồi thì KHÔNG xoá (mất lịch sử) — tắt Active thay vì xoá.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.supportEmailThreads)
    .where(eq(schema.supportEmailThreads.accountId, params.id));
  if (Number(n) > 0) {
    return NextResponse.json({ ok: false, error: `hộp thư này đã có ${n} thread — tắt Active thay vì xoá để giữ lịch sử` }, { status: 400 });
  }
  const rows = await db.delete(schema.supportEmailAccounts)
    .where(eq(schema.supportEmailAccounts.id, params.id)).returning({ id: schema.supportEmailAccounts.id });
  if (!rows.length) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
