import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, like } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { hasAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

// DELETE /api/fulfillment/[id] — xoá 1 bản ghi đẩy (dùng dọn đơn đẩy thử/trùng).
// Xoá luôn bút toán base_cost tương ứng; nếu đơn hết bản ghi đẩy thì đưa về "new".
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (await levelOf(session, "fulfillment")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!(await hasAction(session, "fulfillment.undo"))) return NextResponse.json({ ok: false, error: "forbidden: undo" }, { status: 403 });

  const [ffo] = await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.id, params.id)).limit(1);
  if (!ffo) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  // Hoàn sổ: xoá bút toán base_cost có note chứa external_ff_id của bản ghi này
  if (ffo.externalFfId) {
    await db.delete(schema.transactions).where(and(
      eq(schema.transactions.orderId, ffo.orderId),
      eq(schema.transactions.type, "base_cost"),
      like(schema.transactions.note, `%${ffo.externalFfId}%`),
    ));
  }
  await db.delete(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.id, params.id));

  // Còn bản ghi đẩy nào cho đơn này không? Không → đưa đơn về "new"
  const [rest] = await db.select({ id: schema.fulfillmentOrders.id }).from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.orderId, ffo.orderId)).limit(1);
  if (!rest) {
    const [ord] = await db.select({ status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, ffo.orderId)).limit(1);
    if (ord && ["created", "in_production", "shipped", "delivered"].includes(ord.status)) {
      await db.update(schema.orders).set({ status: "new", updatedAt: new Date() }).where(eq(schema.orders.id, ffo.orderId));
    }
  }
  return NextResponse.json({ ok: true, revertedToNew: !rest });
}
