import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { hasAction } from "@/lib/actions";
import { scopeOwnerIds } from "@/lib/scope";
import { refundOrderCost, cancelAtPrinters } from "@/lib/order-status";

export const dynamic = "force-dynamic";

// POST /api/orders/bulk — { ids: string[], status: OrderStatus }
// Đổi trạng thái hàng loạt. Vào trash → hoàn base cost từng đơn.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  // Đổi trạng thái hàng loạt: admin hoặc support (staff phụ trách xử lý đơn)
  if (session.role !== "admin" && session.role !== "support") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(b?.ids) ? b.ids.slice(0, 500) : [];
  let status: string = b?.status;
  if (status === "trash") status = "cancel"; // alias cũ — Trash nay là Cancel
  if (!ids.length) return NextResponse.json({ ok: false, error: "no orders selected" }, { status: 400 });
  if (status === "out_of_stock") {
    return NextResponse.json({ ok: false, error: "This status is deprecated — use Cancel / Has Issues" }, { status: 400 });
  }
  if (!(schema.orders.status.enumValues as readonly string[]).includes(status)) {
    return NextResponse.json({ ok: false, error: "invalid status" }, { status: 400 });
  }
  if (status === "cancel" && !(await hasAction(session, "orders.trash"))) {
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

  // Cancel → hoàn base cost từng đơn (idempotent) + best-effort huỷ luôn bên nhà in
  let refunded = 0;
  if (status === "cancel") {
    for (const o of allowed) {
      if (await refundOrderCost(o.id, "Refund cost — order cancelled (bulk)")) refunded++;
      await cancelAtPrinters(o.id);
    }
  }
  return NextResponse.json({ ok: true, updated: allowed.length, skipped: ids.length - allowed.length, refunded });
}
