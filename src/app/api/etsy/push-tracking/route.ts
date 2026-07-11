import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { pushEtsyTrackingForOrder } from "@/lib/etsy-tracking";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { orderId, sendBcc? } — đẩy tracking của đơn Etsy lên Etsy qua API (createReceiptShipment).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => ({})) as { orderId?: string; sendBcc?: boolean };
  if (!b.orderId) return NextResponse.json({ ok: false, error: "missing orderId" }, { status: 400 });

  const r = await pushEtsyTrackingForOrder(b.orderId, { sendBcc: b.sendBcc !== false });
  return NextResponse.json(r);
}
