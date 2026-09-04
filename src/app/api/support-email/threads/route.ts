import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { supportMailReady, MAIL_FOLDERS, type MailFolder } from "@/lib/support-mail";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

// GET /api/support-email/threads?folder=inbox&status=open|closed&account=<id|env>&page=1
// Danh sách thread theo FOLDER (như webmail) + phân trang 20/trang + đếm số thread từng folder.
// Quyền: role admin/support + module support ≥ 1.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  // Chỉ role admin/support được vào Customer Emails (khớp gate của trang).
  if (session.role !== "admin" && session.role !== "support") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if ((await levelOf(session, "support")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const q = req.nextUrl.searchParams;
  const status = q.get("status");
  const account = q.get("account"); // id hộp thư | "env" (thread account_id NULL) | rỗng = tất cả
  const folderRaw = q.get("folder") ?? "inbox";
  const folder = (MAIL_FOLDERS as readonly string[]).includes(folderRaw) ? (folderRaw as MailFolder) : "inbox";
  const page = Math.max(1, Number(q.get("page")) || 1);

  const conds: SQL[] = [
    // Thread thuộc folder F = có ít nhất 1 mail đang nằm ở folder F.
    sql`EXISTS (SELECT 1 FROM support_email_messages m WHERE m.thread_id = ${schema.supportEmailThreads.id} AND m.folder = ${folder})`,
  ];
  if (status === "open" || status === "closed") conds.push(eq(schema.supportEmailThreads.status, status));
  if (account === "env") conds.push(isNull(schema.supportEmailThreads.accountId));
  else if (account) conds.push(eq(schema.supportEmailThreads.accountId, account));
  const where = and(...conds);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(schema.supportEmailThreads).where(where);
  const totalPages = Math.max(1, Math.ceil(Number(total) / PAGE_SIZE));
  const rows = await db.select().from(schema.supportEmailThreads).where(where)
    .orderBy(desc(schema.supportEmailThreads.lastMessageAt))
    .limit(PAGE_SIZE).offset((Math.min(page, totalPages) - 1) * PAGE_SIZE);

  // Đếm số thread mỗi folder (tôn trọng filter account, KHÔNG dính filter status/folder).
  const accSql = account === "env"
    ? sql` AND t.account_id IS NULL`
    : account ? sql` AND t.account_id = ${account}` : sql``;
  const fc = (await db.execute(sql`
    SELECT m.folder, COUNT(DISTINCT m.thread_id)::int AS n
    FROM support_email_messages m
    JOIN support_email_threads t ON t.id = m.thread_id
    WHERE 1=1${accSql}
    GROUP BY m.folder
  `)).rows as { folder: string; n: number }[];
  const folderCounts: Record<string, number> = {};
  for (const r of fc) folderCounts[r.folder] = Number(r.n);

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

  return NextResponse.json({
    ok: true, threads: rows, page: Math.min(page, totalPages), totalPages, total,
    folder, folderCounts, accounts, configured: await supportMailReady(),
  });
}
