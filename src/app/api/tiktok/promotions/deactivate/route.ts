import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { resolveStore } from "@/lib/tiktok-support";
import { ttDeactivatePromotion } from "@/lib/tiktok-shop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/tiktok/promotions/deactivate { storeId, activityId } — dừng chương trình khuyến mãi.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "marketing")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const storeId = String(b.storeId ?? "");
  const activityId = String(b.activityId ?? "");
  if (!storeId || !activityId) return NextResponse.json({ ok: false, error: "storeId and activityId required" }, { status: 400 });
  const r = await resolveStore(session, storeId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  try {
    await ttDeactivatePromotion(r.cfg, activityId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
