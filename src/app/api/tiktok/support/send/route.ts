import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { ttSendMessage } from "@/lib/tiktok-shop";
import { resolveStore } from "@/lib/tiktok-support";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/tiktok/support/send  { storeId, conversationId, text }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "support")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const storeId = typeof b.storeId === "string" ? b.storeId : "";
  const conversationId = typeof b.conversationId === "string" ? b.conversationId : "";
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!storeId || !conversationId || !text) return NextResponse.json({ ok: false, error: "missing storeId/conversationId/text" }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ ok: false, error: "Message too long (max 2000)" }, { status: 400 });
  const r = await resolveStore(session, storeId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  try {
    await ttSendMessage(r.cfg, conversationId, text);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
