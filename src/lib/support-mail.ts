import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import { db, schema } from "@/lib/db";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { writeFile } from "@/lib/storage";
import { decryptSecret } from "@/lib/crypto";

/**
 * v392/v393 · Support Email — hộp thư support trong FUSION (PrivateEmail/Namecheap…).
 * v393: NHIỀU hộp thư. Nguồn account:
 *  1. Bảng support_email_accounts (admin thêm/sửa trong FUSION, mật khẩu mã hoá AES-GCM).
 *  2. ENV SUPPORT_EMAIL / SUPPORT_EMAIL_PASS (cách v392) — vẫn chạy như 1 account "ảo"
 *     nếu email đó CHƯA có trong bảng; thread của nó mang account_id = NULL.
 *  - syncSupportMail(): IMAP kéo mail INBOX mới của TẤT CẢ account → threads/messages.
 *  - sendSupportReply(): SMTP gửi trả lời từ đúng hộp thư của thread đó.
 * Nhân viên support KHÔNG bao giờ thấy mật khẩu — chỉ admin quản lý account.
 */

export type MailAccount = {
  id: string | null;          // null = account từ ENV (v392)
  label: string;
  email: string;
  fromName: string;
  imapHost: string; imapPort: number;
  smtpHost: string; smtpPort: number;
  pass: string;
};

function envCfg() {
  return {
    user: (process.env.SUPPORT_EMAIL ?? "").toLowerCase(),
    pass: process.env.SUPPORT_EMAIL_PASS ?? "",
    imapHost: process.env.SUPPORT_IMAP_HOST ?? "mail.privateemail.com",
    imapPort: Number(process.env.SUPPORT_IMAP_PORT ?? 993),
    smtpHost: process.env.SUPPORT_SMTP_HOST ?? "mail.privateemail.com",
    smtpPort: Number(process.env.SUPPORT_SMTP_PORT ?? 465),
    fromName: process.env.SUPPORT_FROM_NAME ?? "Talewix Support",
  };
}
function envAccount(): MailAccount | null {
  const c = envCfg();
  if (!c.user || !c.pass) return null;
  return { id: null, label: c.fromName, email: c.user, fromName: c.fromName, imapHost: c.imapHost, imapPort: c.imapPort, smtpHost: c.smtpHost, smtpPort: c.smtpPort, pass: c.pass };
}

const rowToAccount = (r: typeof schema.supportEmailAccounts.$inferSelect): MailAccount => ({
  id: r.id, label: r.label, email: r.email.toLowerCase(),
  fromName: r.fromName || `${r.label} Support`,
  imapHost: r.imapHost, imapPort: r.imapPort, smtpHost: r.smtpHost, smtpPort: r.smtpPort,
  pass: decryptSecret(r.passEnc),
});

/** Tất cả hộp thư đang bật: bảng accounts + account ENV (nếu email đó chưa có trong bảng). */
export async function allAccounts(): Promise<MailAccount[]> {
  const rows = await db.select().from(schema.supportEmailAccounts)
    .where(eq(schema.supportEmailAccounts.active, true))
    .orderBy(schema.supportEmailAccounts.createdAt);
  const out = rows.map(rowToAccount).filter((a) => a.pass);
  const env = envAccount();
  if (env && !out.some((a) => a.email === env.email)) out.push(env);
  return out;
}

/** Còn dùng cho check nhanh phía server component (env-only, sync). */
export function supportMailConfigured(): boolean {
  return !!envAccount();
}
/** Có ít nhất 1 hộp thư dùng được (DB hoặc ENV)? */
export async function supportMailReady(): Promise<boolean> {
  return (await allAccounts()).length > 0;
}

type Att = { name: string; key: string; size: number; type: string };

const normSubject = (s: string | undefined | null) =>
  (s ?? "").replace(/^((re|fwd?|fw)\s*:\s*)+/i, "").trim().slice(0, 300);
const snippetOf = (p: ParsedMail) => {
  const t = (p.text ?? "").replace(/\s+/g, " ").trim();
  if (t) return t.slice(0, 140);
  const h = (typeof p.html === "string" ? p.html : "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return h.slice(0, 140);
};
const refsOf = (p: ParsedMail): string[] => {
  const out: string[] = [];
  if (p.inReplyTo) out.push(p.inReplyTo);
  const r = p.references;
  if (Array.isArray(r)) out.push(...r);
  else if (typeof r === "string" && r) out.push(r);
  return Array.from(new Set(out.filter(Boolean)));
};

/** Tìm/tạo thread cho 1 mail đến. Ưu tiên nối theo References → (account + email + subject) → tạo mới. */
async function threadFor(p: ParsedMail, fromEmail: string, fromName: string | null, accountId: string | null): Promise<string> {
  const refs = refsOf(p);
  if (refs.length) {
    const hit = await db.select({ threadId: schema.supportEmailMessages.threadId })
      .from(schema.supportEmailMessages)
      .where(inArray(schema.supportEmailMessages.messageId, refs)).limit(1);
    if (hit.length) return hit[0].threadId;
  }
  const subj = normSubject(p.subject);
  const accCond = accountId
    ? sql`${schema.supportEmailThreads.accountId} = ${accountId}`
    : sql`${schema.supportEmailThreads.accountId} IS NULL`;
  const byPair = await db.select({ id: schema.supportEmailThreads.id })
    .from(schema.supportEmailThreads)
    .where(sql`${schema.supportEmailThreads.customerEmail} = ${fromEmail} AND ${schema.supportEmailThreads.subject} = ${subj} AND ${accCond}`)
    .orderBy(desc(schema.supportEmailThreads.lastMessageAt)).limit(1);
  if (byPair.length) return byPair[0].id;
  const [row] = await db.insert(schema.supportEmailThreads).values({
    accountId, customerEmail: fromEmail, customerName: fromName, subject: subj,
  }).returning({ id: schema.supportEmailThreads.id });
  return row.id;
}

const sanitizeName = (s: string) => s.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "file";

/** Kéo mail mới từ INBOX của 1 hộp thư. */
async function syncOneAccount(acc: MailAccount, deadline: number): Promise<Record<string, unknown>> {
  // Cửa sổ quét: hộp thư chưa có thread nào → 30 ngày; đã có → 4 ngày (dedupe bằng Message-ID).
  const accCond = acc.id
    ? sql`${schema.supportEmailThreads.accountId} = ${acc.id}`
    : sql`${schema.supportEmailThreads.accountId} IS NULL`;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.supportEmailThreads).where(accCond);
  const days = Number(n) === 0 ? 30 : 4;
  const since = new Date(Date.now() - days * 86400_000);

  const client = new ImapFlow({
    host: acc.imapHost, port: acc.imapPort, secure: true,
    auth: { user: acc.email, pass: acc.pass },
    logger: false,
  });
  let scanned = 0, created = 0;
  const errors: string[] = [];
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const uids = await client.search({ since }, { uid: true });
    const list = Array.isArray(uids) ? uids : [];
    scanned = list.length;
    if (list.length) {
      // Bước 1: chỉ lấy envelope để biết Message-ID → lọc cái đã có trong DB.
      const metas: { uid: number; mid: string | null }[] = [];
      for await (const msg of client.fetch(list, { envelope: true, uid: true }, { uid: true })) {
        metas.push({ uid: msg.uid, mid: msg.envelope?.messageId ?? null });
      }
      const mids = metas.map((m) => m.mid).filter(Boolean) as string[];
      const existing = new Set<string>(
        mids.length
          ? (await db.select({ mid: schema.supportEmailMessages.messageId })
              .from(schema.supportEmailMessages)
              .where(inArray(schema.supportEmailMessages.messageId, mids))
            ).map((r) => r.mid ?? "")
          : []
      );
      const fresh = metas.filter((m) => !m.mid || !existing.has(m.mid));

      // Bước 2: chỉ tải FULL source cho mail mới (tối đa 40 mail/vòng cho nhẹ).
      for (const m of fresh.slice(0, 40)) {
        if (Date.now() > deadline) { errors.push("hết thời gian — phần còn lại chờ vòng sau"); break; }
        try {
          const one = await client.fetchOne(String(m.uid), { source: true }, { uid: true });
          if (!one || !one.source) continue;
          const p = await simpleParser(one.source);
          const from = p.from?.value?.[0];
          const fromEmail = (from?.address ?? "").toLowerCase();
          if (!fromEmail) continue;
          const messageId = p.messageId ?? `<uid-${m.uid}@fusion.local>`;
          const direction = fromEmail === acc.email ? "out" : "in";
          const threadId = await threadFor(p, fromEmail, from?.name || null, acc.id);

          // Đính kèm → storage (R2/local), tối đa 10 file, 10MB/file.
          const atts: Att[] = [];
          for (const a of (p.attachments ?? []).slice(0, 10)) {
            try {
              if (!a.content || a.size > 10 * 1024 * 1024) continue;
              const key = `support-email/${threadId}/${Date.now()}-${sanitizeName(a.filename ?? "file")}`;
              await writeFile(key, a.content as Buffer, a.contentType || "application/octet-stream");
              atts.push({ name: a.filename ?? "file", key, size: a.size, type: a.contentType || "" });
            } catch { /* 1 file hỏng không chặn cả mail */ }
          }

          const when = p.date ?? new Date();
          const ins = await db.insert(schema.supportEmailMessages).values({
            threadId, direction, messageId,
            inReplyTo: p.inReplyTo ?? null, refs: refsOf(p).join(" ") || null,
            fromEmail, fromName: from?.name || null, toEmail: acc.email,
            subject: p.subject ?? null,
            bodyText: p.text ?? null,
            bodyHtml: typeof p.html === "string" ? p.html : null,
            attachments: atts, messageAt: when,
          }).onConflictDoNothing({ target: schema.supportEmailMessages.messageId })
            .returning({ id: schema.supportEmailMessages.id });
          if (!ins.length) continue; // trùng Message-ID (đã sync rồi)
          created++;

          await db.update(schema.supportEmailThreads).set({
            lastMessageAt: when, lastSnippet: snippetOf(p),
            lastDirection: direction,
            unread: direction === "in" ? true : undefined,
            status: direction === "in" ? "open" : undefined,
            customerName: from?.name ? from.name : undefined,
            msgCount: sql`${schema.supportEmailThreads.msgCount} + 1`,
          }).where(eq(schema.supportEmailThreads.id, threadId));
        } catch (e) {
          if (errors.length < 5) errors.push(`uid ${m.uid}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
        }
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return { ok: true, scanned, created, ...(errors.length ? { errors } : {}) };
}

/** Kéo mail mới của TẤT CẢ hộp thư đang bật. force=true = nút Sync now. */
export async function syncSupportMail(opts: { force?: boolean } = {}): Promise<Record<string, unknown>> {
  void opts;
  const accounts = await allAccounts();
  if (!accounts.length) return { ok: false, error: "chưa cấu hình hộp thư nào (Mailboxes hoặc SUPPORT_EMAIL env)" };
  const deadline = Date.now() + 45_000; // tổng ngân sách, chia cho các hộp thư
  const byAccount: Record<string, unknown> = {};
  let scanned = 0, created = 0;
  for (const acc of accounts) {
    if (Date.now() > deadline) { byAccount[acc.email] = { ok: false, error: "skipped (time budget)" }; continue; }
    try {
      const r = await syncOneAccount(acc, deadline);
      byAccount[acc.email] = r;
      scanned += Number(r.scanned ?? 0); created += Number(r.created ?? 0);
      if (acc.id) await db.update(schema.supportEmailAccounts).set({ lastSyncAt: new Date(), lastSyncError: null }).where(eq(schema.supportEmailAccounts.id, acc.id));
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 200);
      byAccount[acc.email] = { ok: false, error: msg };
      if (acc.id) await db.update(schema.supportEmailAccounts).set({ lastSyncAt: new Date(), lastSyncError: msg }).where(eq(schema.supportEmailAccounts.id, acc.id)).catch(() => {});
    }
  }
  return { ok: true, scanned, created, accounts: byAccount };
}

/** Gửi trả lời cho 1 thread — từ ĐÚNG hộp thư mà thread đó thuộc về. */
export async function sendSupportReply(args: { threadId: string; body: string; userId: string }): Promise<Record<string, unknown>> {
  const body = (args.body ?? "").trim();
  if (!body) return { ok: false, error: "nội dung trống" };

  const [thread] = await db.select().from(schema.supportEmailThreads)
    .where(eq(schema.supportEmailThreads.id, args.threadId)).limit(1);
  if (!thread) return { ok: false, error: "thread không tồn tại" };

  // Account của thread: theo account_id; thread cũ (NULL) → account ENV.
  let acc: MailAccount | null = null;
  if (thread.accountId) {
    const [row] = await db.select().from(schema.supportEmailAccounts)
      .where(eq(schema.supportEmailAccounts.id, thread.accountId)).limit(1);
    if (row) acc = rowToAccount(row);
  } else acc = envAccount();
  if (!acc || !acc.pass) return { ok: false, error: "hộp thư của thread này chưa cấu hình / đã bị xoá" };

  // Mail khách gần nhất → lấy Message-ID làm In-Reply-To cho đúng chuỗi hội thoại.
  const [lastIn] = await db.select().from(schema.supportEmailMessages)
    .where(sql`${schema.supportEmailMessages.threadId} = ${args.threadId} AND ${schema.supportEmailMessages.direction} = 'in'`)
    .orderBy(desc(schema.supportEmailMessages.messageAt)).limit(1);

  const subjBase = thread.subject || normSubject(lastIn?.subject) || "Your order";
  const subject = /^re:/i.test(subjBase) ? subjBase : `Re: ${subjBase}`;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222">${esc(body).replace(/\n/g, "<br>")}</div>`;
  const references = [lastIn?.refs, lastIn?.messageId].filter(Boolean).join(" ").trim() || undefined;

  const transporter = nodemailer.createTransport({
    host: acc.smtpHost, port: acc.smtpPort, secure: acc.smtpPort === 465,
    auth: { user: acc.email, pass: acc.pass },
  });
  const info = await transporter.sendMail({
    from: `"${acc.fromName}" <${acc.email}>`,
    to: thread.customerEmail,
    subject, text: body, html,
    inReplyTo: lastIn?.messageId ?? undefined,
    references,
  });

  // Best-effort: chép bản gửi vào folder Sent để webmail nhìn thấy (SMTP không tự lưu).
  try {
    const raw = [
      `From: "${acc.fromName}" <${acc.email}>`,
      `To: ${thread.customerEmail}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${info.messageId}`,
      lastIn?.messageId ? `In-Reply-To: ${lastIn.messageId}` : "",
      references ? `References: ${references}` : "",
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      "", body, "",
    ].filter((l) => l !== "").join("\r\n");
    const client = new ImapFlow({ host: acc.imapHost, port: acc.imapPort, secure: true, auth: { user: acc.email, pass: acc.pass }, logger: false });
    await client.connect();
    await client.append("Sent", raw, ["\\Seen"]).catch(() => {});
    await client.logout().catch(() => {});
  } catch { /* không chặn */ }

  const now = new Date();
  const [msg] = await db.insert(schema.supportEmailMessages).values({
    threadId: args.threadId, direction: "out",
    messageId: info.messageId ?? null,
    inReplyTo: lastIn?.messageId ?? null, refs: references ?? null,
    fromEmail: acc.email, fromName: acc.fromName, toEmail: thread.customerEmail,
    subject, bodyText: body, bodyHtml: html,
    attachments: [], sentByUserId: args.userId, messageAt: now,
  }).returning();

  await db.update(schema.supportEmailThreads).set({
    lastMessageAt: now, lastSnippet: body.replace(/\s+/g, " ").slice(0, 140),
    lastDirection: "out", unread: false, status: "open",
    msgCount: sql`${schema.supportEmailThreads.msgCount} + 1`,
  }).where(eq(schema.supportEmailThreads.id, args.threadId));

  return { ok: true, message: msg };
}
