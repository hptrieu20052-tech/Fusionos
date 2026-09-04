import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

type Att = { name: string; key: string; size: number; type: string };

// GET /api/support-email/threads/[id] — toàn bộ message của 1 thread + đánh dấu đã đọc.
// Quyền: support ≥ 1.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.role !== "admin" && session.role !== "support") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if ((await levelOf(session, "support")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const [thread] = await db.select().from(schema.supportEmailThreads)
    .where(eq(schema.supportEmailThreads.id, params.id)).limit(1);
  if (!thread) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const msgs = await db.select().from(schema.supportEmailMessages)
    .where(eq(schema.supportEmailMessages.threadId, params.id))
    .orderBy(asc(schema.supportEmailMessages.messageAt));

  // Mở thread = đã đọc.
  if (thread.unread) {
    await db.update(schema.supportEmailThreads).set({ unread: false })
      .where(eq(schema.supportEmailThreads.id, params.id));
  }

  const messages = msgs.map((m) => ({
    ...m,
    attachments: ((m.attachments ?? []) as Att[]).map((a) => ({ ...a, url: fileUrl(a.key) })),
  }));
  return NextResponse.json({ ok: true, thread: { ...thread, unread: false }, messages });
}

// PATCH /api/support-email/threads/[id] { status: "open" | "closed" } — đóng/mở thread.
// Quyền: support ≥ 2.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.role !== "admin" && session.role !== "support") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if ((await levelOf(session, "support")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const status = body?.status === "closed" ? "closed" : body?.status === "open" ? "open" : null;
  if (!status) return NextResponse.json({ ok: false, error: "status must be open or closed" }, { status: 400 });

  const rows = await db.update(schema.supportEmailThreads).set({ status })
    .where(eq(schema.supportEmailThreads.id, params.id)).returning({ id: schema.supportEmailThreads.id });
  if (!rows.length) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, status });
}
