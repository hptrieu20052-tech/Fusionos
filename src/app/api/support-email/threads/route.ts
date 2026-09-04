import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, desc, eq, isNull, type SQL } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { supportMailReady } from "@/lib/support-mail";

export const dynamic = "force-dynamic";

// GET /api/support-email/threads?status=open|closed&account=<id|env> — danh sách thread.
// Quyền: support ≥ 1 (xem). Kèm danh sách hộp thư (id/label/email) để client lọc.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  // Chỉ role admin/support được vào Customer Emails (khớp gate của trang).
  if (session.role !== "admin" && session.role !== "support") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if ((await levelOf(session, "support")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const status = req.nextUrl.searchParams.get("status");
  const account = req.nextUrl.searchParams.get("account"); // id hộp thư | "env" (thread account_id NULL) | rỗng = tất cả
  const conds: SQL[] = [];
  if (status === "open" || status === "closed") conds.push(eq(schema.supportEmailThreads.status, status));
  if (account === "env") conds.push(isNull(schema.supportEmailThreads.accountId));
  else if (account) conds.push(eq(schema.supportEmailThreads.accountId, account));

  const base = db.select().from(schema.supportEmailThreads);
  const rows = await (conds.length ? base.where(and(...conds)) : base)
    .orderBy(desc(schema.supportEmailThreads.lastMessageAt)).limit(300);

  const accRows = await db.select({
    id: schema.supportEmailAccounts.id, label: schema.supportEmailAccounts.label,
    email: schema.supportEmailAccounts.email, active: schema.supportEmailAccounts.active,
  }).from(schema.supportEmailAccounts);
  const envEmail = (process.env.SUPPORT_EMAIL ?? "").toLowerCase();
  const accounts = [
    ...accRows,
    // Hộp thư ENV (v392) hiển thị như 1 mục lọc riêng nếu còn dùng và chưa được đưa vào bảng.
    ...(envEmail && !accRows.some((a) => a.email.toLowerCase() === envEmail)
      ? [{ id: "env", label: process.env.SUPPORT_FROM_NAME ?? envEmail, email: envEmail, active: true }] : []),
  ];

  return NextResponse.json({ ok: true, threads: rows, accounts, configured: await supportMailReady() });
}
