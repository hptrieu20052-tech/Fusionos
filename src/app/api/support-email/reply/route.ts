import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { sendSupportReply } from "@/lib/support-mail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/support-email/reply { threadId, body } — gửi trả lời từ support@talewix.com.
// Quyền: support ≥ 2 (full).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.role !== "admin" && session.role !== "support") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if ((await levelOf(session, "support")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const threadId = String(b?.threadId ?? "");
  const body = String(b?.body ?? "");
  if (!threadId) return NextResponse.json({ ok: false, error: "thiếu threadId" }, { status: 400 });

  try {
    const res = await sendSupportReply({ threadId, body, userId: session.sub });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
