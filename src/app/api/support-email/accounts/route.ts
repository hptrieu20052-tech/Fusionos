import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { encryptSecret } from "@/lib/crypto";
import { supportMailConfigured } from "@/lib/support-mail";

export const dynamic = "force-dynamic";

// GET /api/support-email/accounts — danh sách hộp thư.
//  support ≥ 1: bản rút gọn (id, label, email, active) để lọc inbox.
//  admin: thêm host/port, lastSync, lỗi sync — KHÔNG BAO GIỜ trả mật khẩu.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const isAdmin = session.role === "admin";
  if (!isAdmin && session.role !== "support") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!isAdmin && (await levelOf(session, "support")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const rows = await db.select().from(schema.supportEmailAccounts).orderBy(asc(schema.supportEmailAccounts.createdAt));
  const accounts = rows.map((r) => ({
    id: r.id, label: r.label, email: r.email, active: r.active,
    ...(isAdmin ? {
      fromName: r.fromName, imapHost: r.imapHost, imapPort: r.imapPort,
      smtpHost: r.smtpHost, smtpPort: r.smtpPort,
      lastSyncAt: r.lastSyncAt, lastSyncError: r.lastSyncError,
    } : {}),
  }));
  return NextResponse.json({ ok: true, accounts, envConfigured: supportMailConfigured(), envEmail: isAdmin ? (process.env.SUPPORT_EMAIL ?? null) : null, isAdmin });
}

// POST /api/support-email/accounts — thêm hộp thư mới (ADMIN). Mật khẩu mã hoá trước khi lưu.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const label = String(b?.label ?? "").trim();
  const email = String(b?.email ?? "").trim().toLowerCase();
  const pass = String(b?.pass ?? "");
  if (!label || !email || !pass) return NextResponse.json({ ok: false, error: "label, email and password are required" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: "invalid email" }, { status: 400 });

  const dup = await db.select({ id: schema.supportEmailAccounts.id }).from(schema.supportEmailAccounts)
    .where(eq(schema.supportEmailAccounts.email, email)).limit(1);
  if (dup.length) return NextResponse.json({ ok: false, error: "this email already exists" }, { status: 400 });

  const [row] = await db.insert(schema.supportEmailAccounts).values({
    label, email,
    fromName: String(b?.fromName ?? "").trim() || null,
    imapHost: String(b?.imapHost ?? "").trim() || "mail.privateemail.com",
    imapPort: Number(b?.imapPort) || 993,
    smtpHost: String(b?.smtpHost ?? "").trim() || "mail.privateemail.com",
    smtpPort: Number(b?.smtpPort) || 465,
    passEnc: encryptSecret(pass),
  }).returning({ id: schema.supportEmailAccounts.id });
  return NextResponse.json({ ok: true, id: row.id });
}
