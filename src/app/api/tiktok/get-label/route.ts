import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { fetchAndStoreTiktokLabels } from "@/lib/tiktok-label";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { orderId } — lấy label TikTok Shipping của đơn → lưu R2 → trả link cho supplier.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "orders")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.orderId) return NextResponse.json({ ok: false, error: "missing orderId" }, { status: 400 });

  const r = await fetchAndStoreTiktokLabels(String(b.orderId));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
