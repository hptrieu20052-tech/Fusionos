import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { syncPrintway } from "@/lib/printway-sync";
import { syncPrintify } from "@/lib/printify-sync";
import { syncOnosWem } from "@/lib/onos-wem-sync";
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
  // Chạy TẤT CẢ nhà in (trước đây mở trang Orders chỉ đồng bộ Printway → Merchize/ONOS/Wem/FlashShip
  // phải đợi cron 5' + throttle 10'/nhà). Bản thân mỗi sync vẫn tự throttle nên gọi dày vẫn an toàn.
  const fail = (e: unknown) => ({ ok: false, updated: 0, errors: [String((e as Error)?.message ?? e)] });
  const [printway, printify, others] = await Promise.all([
    syncPrintway({ force }).catch(fail),
    syncPrintify({ force }).catch(fail),
    syncOnosWem({ force }).catch(fail),
  ]);
  const updated = (printway.updated ?? 0) + (printify.updated ?? 0) + (others.updated ?? 0);
  return NextResponse.json({ ok: true, updated, printway, printify, others });
}

// GET ?debug=<external_ff_id | fulfillment_order_id> — trả RAW /order/detail của Printway + giá bóc được.
// Chỉ admin. Dùng khi cost vẫn = 0 để xem Printway thực sự trả field gì.
// Nhận thẳng mã hiện trên UI, vd: ?debug=PWN8780848
export async function GET(req: NextRequest) {
  const session = await getSession();
  // Thang level tối đa là 2 (admin = 2) → chỉ cần admin hoặc level 2 module fulfillment
  if (!session || (session.role !== "admin" && (await levelOf(session, "fulfillment")) < 2)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const id = (req.nextUrl.searchParams.get("debug") ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "missing ?debug=<PWN… hoặc ffoId>" }, { status: 400 });

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const [ffo] = await db.select().from(schema.fulfillmentOrders)
    .where(isUuid ? eq(schema.fulfillmentOrders.id, id) : eq(schema.fulfillmentOrders.externalFfId, id))
    .limit(1);
  if (!ffo) return NextResponse.json({ ok: false, error: "không tìm thấy bản ghi đẩy nào khớp " + id }, { status: 404 });
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
