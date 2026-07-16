import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { resolveStore } from "@/lib/tiktok-support";
import { ttSearchPromotions } from "@/lib/tiktok-shop";
import { simplifyActivity } from "@/lib/tiktok-promotions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/tiktok/promotions/list?storeId=&status=&type= — danh sách chương trình khuyến mãi của 1 shop.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "marketing")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const storeId = url.searchParams.get("storeId") ?? "";
  if (!storeId) return NextResponse.json({ ok: false, error: "storeId required" }, { status: 400 });
  const r = await resolveStore(session, storeId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  try {
    const status = url.searchParams.get("status") || undefined;
    const activityType = url.searchParams.get("type") || undefined;
    const { activities, nextPageToken, totalCount } = await ttSearchPromotions(r.cfg, { status, activityType, pageSize: 50 });
    return NextResponse.json({ ok: true, activities: activities.map(simplifyActivity), nextPageToken, totalCount });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
