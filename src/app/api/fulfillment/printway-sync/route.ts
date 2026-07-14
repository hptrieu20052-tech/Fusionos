import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { syncPrintway } from "@/lib/printway-sync";
import { syncPrintify } from "@/lib/printify-sync";
import { getPrintwayOrderDetail, extractPwCost } from "@/lib/printway-api";
import { pwCredOf } from "@/lib/printway-cost";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { force? } — poll trạng thái + tracking + CHI PHÍ của Printway VÀ Printify.
// (Giữ nguyên đường dẫn cũ để không phải sửa client.) Throttle 10 phút/nhà in, force bỏ throttle.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { force?: boolean };
  const force = !!b.force;
  const [printway, printify] = await Promise.all([
    syncPrintway({ force }).catch((e) => ({ ok: false, updated: 0, errors: [String((e as Error)?.message ?? e)] })),
    syncPrintify({ force }).catch((e) => ({ ok: false, updated: 0, errors: [String((e as Error)?.message ?? e)] })),
  ]);
  const updated = (printway.updated ?? 0) + (printify.updated ?? 0);
  return NextResponse.json({ ok: true, updated, printway, printify });
}

// GET ?debug=<fulfillment_order_id> — trả RAW /order/detail của Printway + giá bóc được.
// Chỉ admin. Dùng khi cost vẫn = 0 để xem Printway thực sự trả field gì.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "fulfillment")) < 3) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get("debug");
  if (!id) return NextResponse.json({ ok: false, error: "missing ?debug=<ffoId>" }, { status: 400 });

  const [ffo] = await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.id, id)).limit(1);
  if (!ffo) return NextResponse.json({ ok: false, error: "ffo not found" }, { status: 404 });
  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, ffo.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller not found" }, { status: 404 });
  const cred = pwCredOf(ff);
  if (!cred) return NextResponse.json({ ok: false, error: "no access token" }, { status: 400 });

  const [ord] = await db.select({ label: schema.orders.orderLabel, ext: schema.orders.externalId })
    .from(schema.orders).where(eq(schema.orders.id, ffo.orderId)).limit(1);
  const orderName = (ord?.label?.trim() || ord?.ext || "") || undefined;
  const pwOrderId = ffo.externalFfId && /^PW/i.test(ffo.externalFfId) ? ffo.externalFfId : undefined;

  const detail = await getPrintwayOrderDetail(cred, { pwOrderId, orderName }).catch((e) => ({ error: String((e as Error)?.message ?? e) }));
  return NextResponse.json({
    ok: true,
    sentAs: { pw_order_id: pwOrderId ?? null, order_name: orderName ?? null },
    parsed: extractPwCost(detail as Record<string, unknown>),
    detail,
  });
}
