import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { syncSupportMail, supportMailReady } from "@/lib/support-mail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/support-email/sync — nút "Sync now": kéo mail mới ngay lập tức.
// Quyền: support ≥ 1 (ai xem được inbox thì bấm sync được).
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.role !== "admin" && session.role !== "support") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if ((await levelOf(session, "support")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!(await supportMailReady())) {
    return NextResponse.json({ ok: false, error: "No mailbox configured — add one in Mailboxes" }, { status: 400 });
  }
  try {
    const res = await syncSupportMail({ force: true });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
