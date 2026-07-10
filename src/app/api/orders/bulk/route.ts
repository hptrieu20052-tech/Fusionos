import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { hasAction } from "@/lib/actions";
import { scopeOwnerIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

// POST /api/orders/bulk — { ids: string[], status: OrderStatus }
// Đổi trạng thái hàng loạt. Vào trash → hoàn base cost từng đơn.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  // Đổi trạng thái hàng loạt chỉ dành cho admin (staff/seller đã ẩn ở UI)
  if (session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(b?.ids) ? b.ids.slice(0, 500) : [];
  const status: string = b?.status;
  if (!ids.length) return NextResponse.json({ ok: false, error: "no orders selected" }, { status: 400 });
  if (status === "cancel" || status === "out_of_stock") {
    return NextResponse.json({ ok: false, error: "This status is deprecated — use Trash / Has Issues" }, { status: 400 });
  }
  if (!(schema.orders.status.enumValues as readonly string[]).includes(status)) {
    return NextResponse.json({ ok: false, error: "invalid status" }, { status: 400 });
  }
  if (status === "trash" && !(await hasAction(session, "orders.trash"))) {
    return NextResponse.json({ ok: false, error: "forbidden: trash" }, { status: 403 });
  }

  // own_orders_only: chỉ đổi đơn của chính mình
  const scopeIds = await scopeOwnerIds(session, "orders");
  const orders = await db.select().from(schema.orders).where(inArray(schema.orders.id, ids));
  const allowed = scopeIds ? orders.filter((o) => o.sellerId && scopeIds.includes(o.sellerId)) : orders;
  if (!allowed.length) return NextResponse.json({ ok: false, error: "no valid orders" }, { status: 400 });

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
          note: "Refund cost — order moved to Trash (bulk)",
          occurredAt: new Date().toISOString().slice(0, 10),
        });
        refunded++;
      }
    }
  }
  return NextResponse.json({ ok: true, updated: allowed.length, skipped: ids.length - allowed.length, refunded });
}
