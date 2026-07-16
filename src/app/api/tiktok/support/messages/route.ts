import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ttGetConversationMessages } from "@/lib/tiktok-shop";
import { resolveStore, simplifyMessage } from "@/lib/tiktok-support";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/tiktok/support/messages?storeId=&conversationId=&pageToken=
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const storeId = sp.get("storeId");
  const conversationId = sp.get("conversationId");
  const pageToken = sp.get("pageToken") || undefined;
  if (!storeId || !conversationId) return NextResponse.json({ ok: false, error: "missing storeId/conversationId" }, { status: 400 });
  const r = await resolveStore(session, storeId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  try {
    const { messages, nextPageToken } = await ttGetConversationMessages(r.cfg, conversationId, pageToken, 10);
    // API trả DESC (mới→cũ); đảo lại ASC để hiện như chat (cũ trên, mới dưới).
    const list = messages.map(simplifyMessage).filter((m) => m.isVisible).sort((a, b) => a.time - b.time || a.index.localeCompare(b.index));
    return NextResponse.json({ ok: true, messages: list, nextPageToken });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
