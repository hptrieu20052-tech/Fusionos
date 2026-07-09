import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf, hasRestriction } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// POST /api/orders/bulk — { ids: string[], status: OrderStatus }
// Đổi trạng thái hàng loạt. Vào trash → hoàn base cost từng đơn.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(b?.ids) ? b.ids.slice(0, 500) : [];
  const status: string = b?.status;
  if (!ids.length) return NextResponse.json({ ok: false, error: "chưa chọn đơn nào" }, { status: 400 });
  if (status === "cancel" || status === "out_of_stock") {
    return NextResponse.json({ ok: false, error: "Trạng thái này đã bỏ — dùng Trash / Has Issues" }, { status: 400 });
  }
  if (!(schema.orders.status.enumValues as readonly string[]).includes(status)) {
    return NextResponse.json({ ok: false, error: "trạng thái không hợp lệ" }, { status: 400 });
  }

  // own_orders_only: chỉ đổi đơn của chính mình
  const own = await hasRestriction(session, "own_orders_only");
  const orders = await db.select().from(schema.orders).where(inArray(schema.orders.id, ids));
  const allowed = own ? orders.filter((o) => o.sellerId === session.sub) : orders;
  if (!allowed.length) return NextResponse.json({ ok: false, error: "không có đơn hợp lệ" }, { status: 400 });

  await db.update(schema.orders)
    .set({ status: status as never, updatedAt: new Date() })
    .where(inArray(schema.orders.id, allowed.map((o) => o.id)));

  // Trash → hoàn base cost từng đơn (idempotent: chỉ hoàn phần còn âm)
  let refunded = 0;
  if (status === "trash") {
    for (const o of allowed) {
      const bal = Number(((await db.execute(sql`
        SELECT coalesce(sum(amount),0)::numeric s FROM transactions WHERE order_id = ${o.id}::uuid AND type='base_cost'
      `)).rows[0] as { s: string }).s);
      if (bal < 0) {
        await db.insert(schema.transactions).values({
          type: "base_cost", amount: (-bal).toFixed(2),
          orderId: o.id, storeId: o.storeId, sellerId: o.sellerId,
          note: "Hoàn giá vốn — đơn chuyển vào Trash (bulk)",
          occurredAt: new Date().toISOString().slice(0, 10),
        });
        refunded++;
      }
    }
  }
  return NextResponse.json({ ok: true, updated: allowed.length, skipped: ids.length - allowed.length, refunded });
}
