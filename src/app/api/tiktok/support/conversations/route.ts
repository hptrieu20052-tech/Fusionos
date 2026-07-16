import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ttGetConversations } from "@/lib/tiktok-shop";
import { resolveStore, simplifyConversation } from "@/lib/tiktok-support";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/tiktok/support/conversations?storeId=&pageToken=
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const storeId = req.nextUrl.searchParams.get("storeId");
  const pageToken = req.nextUrl.searchParams.get("pageToken") || undefined;
  if (!storeId) return NextResponse.json({ ok: false, error: "missing storeId" }, { status: 400 });
  const r = await resolveStore(session, storeId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  try {
    const { conversations, nextPageToken } = await ttGetConversations(r.cfg, pageToken, 20);
    const list = conversations.map((cv) => simplifyConversation(cv, storeId, r.store.name)).sort((a, b) => b.lastTime - a.lastTime);
    return NextResponse.json({ ok: true, conversations: list, nextPageToken });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
