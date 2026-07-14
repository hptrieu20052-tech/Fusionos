import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, like } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { hasAction } from "@/lib/actions";
import { cancelPrintwayOrder, deletePrintwayOrder } from "@/lib/printway-api";
import { cancelFlashshipOrders } from "@/lib/flashship";
import { rebalanceOrderCost } from "@/lib/order-status";

export const dynamic = "force-dynamic";

// DELETE /api/fulfillment/[id] — xoá 1 bản ghi đẩy (dùng dọn đơn đẩy thử/trùng).
// Xoá luôn bút toán base_cost tương ứng; nếu đơn hết bản ghi đẩy thì đưa về "new".
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (await levelOf(session, "fulfillment")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!(await hasAction(session, "fulfillment.undo"))) return NextResponse.json({ ok: false, error: "forbidden: undo" }, { status: 403 });

  const [ffo] = await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.id, params.id)).limit(1);
  if (!ffo) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  // Đơn Printway/FlashShip THẬT (không phải SIM) → best-effort huỷ luôn bên nhà in.
  // Fail không chặn xoá local — ghi kèm remote result để người dùng biết cần huỷ tay.
  let remote: { attempted: boolean; ok: boolean; message: string } = { attempted: false, ok: false, message: "" };
  if (ffo.externalFfId && !ffo.externalFfId.startsWith("SIM-")) {
    const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, ffo.fulfillerId)).limit(1);
    const ffName = (ff?.name ?? "").toLowerCase();
    const c = (ff?.credentials ?? {}) as Record<string, string>;
    const accessToken = c.apiKey || c.accessToken || c.apiToken;
    if (ff && accessToken && ffName.includes("printway")) {
      const cred = { accessToken, endpoint: ff.apiEndpoint };
      const isPwId = /^PW/i.test(ffo.externalFfId);
      const [ord] = await db.select({ externalId: schema.orders.externalId, orderLabel: schema.orders.orderLabel }).from(schema.orders).where(eq(schema.orders.id, ffo.orderId)).limit(1);
      const orderName = (ord?.orderLabel || ord?.externalId || (!isPwId ? ffo.externalFfId : "")) || undefined;
      const p = { pwOrderId: isPwId ? ffo.externalFfId : undefined, orderName };
      try {
        let r = await cancelPrintwayOrder(cred, p);
        if (!r.ok) r = await deletePrintwayOrder(cred, p); // đơn chưa trả tiền → delete được
        remote = { attempted: true, ok: r.ok, message: r.message };
      } catch (e) {
        remote = { attempted: true, ok: false, message: String((e as Error)?.message ?? e).slice(0, 160) };
      }
    } else if (ff && accessToken && ffName.includes("flashship")) {
      try {
        const r = await cancelFlashshipOrders({ accessToken, endpoint: ff.apiEndpoint }, [ffo.externalFfId], "Cancelled from FUSION OS");
        remote = { attempted: true, ok: r.ok, message: r.message };
      } catch (e) {
        remote = { attempted: true, ok: false, message: String((e as Error)?.message ?? e).slice(0, 160) };
      }
    }
  }

  // Hoàn sổ: xoá bút toán base_cost có note chứa external_ff_id của bản ghi này
  if (ffo.externalFfId) {
    await db.delete(schema.transactions).where(and(
      eq(schema.transactions.orderId, ffo.orderId),
      eq(schema.transactions.type, "base_cost"),
      like(schema.transactions.note, `%${ffo.externalFfId}%`),
    ));
  }
  await db.delete(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.id, params.id));

  // CÂN LẠI SỔ: dòng hoàn tiền (refundOrderCost) có note "Refund cost — …" nên KHÔNG bị xoá ở
  // bước trên → nếu bỏ qua, nó nằm lại một mình và làm cost ÂM. Rebalance xoá/điều chỉnh cho khớp
  // với các bản ghi đẩy còn lại.
  const rebalanced = await rebalanceOrderCost(ffo.orderId, "Cost adjustment — rebalanced after push removed");

  // Còn bản ghi đẩy nào cho đơn này không? Không → đưa đơn về "new"
  const [rest] = await db.select({ id: schema.fulfillmentOrders.id }).from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.orderId, ffo.orderId)).limit(1);
  if (!rest) {
    const [ord] = await db.select({ status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, ffo.orderId)).limit(1);
    if (ord && ["created", "in_production", "shipped", "delivered"].includes(ord.status)) {
      await db.update(schema.orders).set({ status: "new", updatedAt: new Date() }).where(eq(schema.orders.id, ffo.orderId));
    }
  }
  return NextResponse.json({ ok: true, revertedToNew: !rest, rebalanced, remote });
}
