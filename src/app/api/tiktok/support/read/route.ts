import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ttReadConversation } from "@/lib/tiktok-shop";
import { resolveStore } from "@/lib/tiktok-support";

export const dynamic = "force-dynamic";

// POST /api/tiktok/support/read  { storeId, conversationId } — đánh dấu đã đọc.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const storeId = typeof b.storeId === "string" ? b.storeId : "";
  const conversationId = typeof b.conversationId === "string" ? b.conversationId : "";
  if (!storeId || !conversationId) return NextResponse.json({ ok: false, error: "missing storeId/conversationId" }, { status: 400 });
  const r = await resolveStore(session, storeId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  try {
    await ttReadConversation(r.cfg, conversationId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
