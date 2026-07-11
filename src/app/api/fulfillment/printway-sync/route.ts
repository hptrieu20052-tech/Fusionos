import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { syncPrintway } from "@/lib/printway-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { force? } — poll trạng thái + tracking đơn Printway (throttle 10 phút, force bỏ throttle).
// Được gọi ngầm khi mở trang Orders, hoặc bấm tay.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { force?: boolean };
  const r = await syncPrintway({ force: !!b.force });
  return NextResponse.json(r);
}
