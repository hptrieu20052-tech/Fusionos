import { db, schema } from "@/lib/db";
import {and, eq, inArray, sql } from "drizzle-orm";

// Khi đơn có tracking (webhook fulfiller trả về / nhập tay / import) → tự chuyển sang "shipped".
// Chỉ nâng từ các trạng thái trước đó; KHÔNG đụng đơn đã shipped/delivered/trash/cancel.
export async function markShippedOnTracking(orderId: string) {
  try {
    await db.update(schema.orders)
      .set({ status: "shipped" })
      .where(and(
        eq(schema.orders.id, orderId),
        inArray(schema.orders.status, ["new", "created", "in_production", "has_issues"] as never),
      ));
  } catch {
    // best-effort: không làm hỏng luồng webhook/nhập tracking nếu lỗi
  }
}

// Sau khi đẩy đơn sang nhà in (tạo fulfillment order) → chuyển "created".
export async function markCreatedOnPush(orderId: string) {
  try {
    await db.update(schema.orders).set({ status: "created" })
      .where(and(eq(schema.orders.id, orderId), inArray(schema.orders.status, ["new", "has_issues"] as never)));
  } catch { /* best-effort */ }
}

// Đồng bộ trạng thái đơn theo trạng thái nhà in (chỉ tiến tới, không lùi).
// fulfiller "in_production" → In Production; "shipped" → Shipped; "delivered" → Completed.
export async function syncOrderFromFf(orderId: string, ffStatus: string) {
  const map: Record<string, { target: string; prev: string[] }> = {
    in_production: { target: "in_production", prev: ["new", "created", "has_issues"] },
    shipped: { target: "shipped", prev: ["new", "created", "in_production", "has_issues"] },
    delivered: { target: "delivered", prev: ["new", "created", "in_production", "shipped", "has_issues"] },
    // Nhà in huỷ đơn → đơn FUSION nhảy Cancel + hoàn cost = 0 (không đụng đơn đã shipped/delivered)
    cancelled: { target: "cancel", prev: ["new", "created", "in_production", "has_issues"] },
  };
  const m = map[ffStatus];
  if (!m) return;
  try {
    await db.update(schema.orders).set({ status: m.target as never })
      .where(and(eq(schema.orders.id, orderId), inArray(schema.orders.status, m.prev as never)));
    if (ffStatus === "cancelled") await refundOrderCost(orderId, "Refund cost — cancelled by fulfiller");
  } catch { /* best-effort */ }
}

/**
 * Hoàn giá vốn về 0 cho đơn cancel (idempotent: chỉ hoàn phần base_cost còn âm).
 * Dùng chung cho: cancel từ FUSION, webhook nhà in báo cancel, poll thấy cancel.
 */
export async function refundOrderCost(orderId: string, note: string) {
  try {
    const sum = (await db.execute(sql`
      SELECT coalesce(sum(amount),0)::numeric s FROM transactions WHERE order_id = ${orderId}::uuid AND type = 'base_cost'
    `)).rows[0] as { s: string };
    const bal = Number(sum.s);
    if (bal >= 0) return false;
    const [ord] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
    await db.insert(schema.transactions).values({
      type: "base_cost", amount: (-bal).toFixed(2),
      orderId, storeId: ord?.storeId ?? null, sellerId: ord?.sellerId ?? null,
      note, occurredAt: new Date().toISOString().slice(0, 10),
    });
    return true;
  } catch { return false; }
}

/**
 * CÂN LẠI SỔ giá vốn của 1 đơn: tổng bút toán base_cost phải = -(tổng cost của các bản ghi đẩy còn lại).
 *
 * Vì sao cần: dòng hoàn tiền của refundOrderCost() có note "Refund cost — …" (KHÔNG chứa
 * external_ff_id), nên khi xoá bản ghi đẩy (chỉ xoá bút toán khớp external_ff_id) thì dòng
 * hoàn tiền +X bị bỏ lại mồ côi → Finance/Dashboard hiện cost ÂM.
 *
 * - Không còn bản ghi đẩy nào có chi phí → xoá SẠCH base_cost của đơn (gồm cả dòng hoàn tiền).
 * - Còn bản ghi đẩy → chèn 1 dòng điều chỉnh cho khớp.
 */
export async function rebalanceOrderCost(orderId: string): Promise<boolean> {
  try {
    const ffos = await db.select({ cost: schema.fulfillmentOrders.cost, status: schema.fulfillmentOrders.status })
      .from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.orderId, orderId));
    const target = -ffos.filter((r) => r.status !== "cancelled").reduce((a, r) => a + Number(r.cost ?? 0), 0);
    const cur = Number(((await db.execute(sql`
      SELECT coalesce(sum(amount),0)::numeric s FROM transactions WHERE order_id = ${orderId}::uuid AND type = 'base_cost'
    `)).rows[0] as { s: string }).s);

    if (Math.abs(cur - target) < 0.005) return false; // đã khớp tới cent
    if (Math.abs(target) < 0.005) {
      await db.delete(schema.transactions).where(and(
        eq(schema.transactions.orderId, orderId),
        eq(schema.transactions.type, "base_cost"),
      ));
      return true;
    }
    const [ord] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
    await db.insert(schema.transactions).values({
      type: "base_cost", amount: (target - cur).toFixed(2),
      orderId, storeId: ord?.storeId ?? null, sellerId: ord?.sellerId ?? null,
      note: "Cost adjustment — rebalanced after push removed",
      occurredAt: new Date().toISOString().slice(0, 10),
    });
    return true;
  } catch { return false; }
}

/**
 * Cancel từ FUSION → best-effort huỷ luôn bên nhà in (Printway cancel/delete, FlashShip seller-reject)
 * cho các bản ghi đẩy THẬT chưa kết thúc, và đánh dấu ffo = cancelled. Fail không chặn.
 */
export async function cancelAtPrinters(orderId: string): Promise<string[]> {
  const notes: string[] = [];
  try {
    const ffos = await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.orderId, orderId));
    for (const ffo of ffos) {
      if (!ffo.externalFfId || ffo.externalFfId.startsWith("SIM-")) continue;
      if (["cancelled", "delivered"].includes(ffo.status)) continue;
      const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, ffo.fulfillerId)).limit(1);
      const name = (ff?.name ?? "").toLowerCase();
      const c = (ff?.credentials ?? {}) as Record<string, string>;
      const accessToken = c.apiKey || c.accessToken || c.apiToken;
      if (!ff || !accessToken) continue;
      try {
        if (name.includes("printway")) {
          const { cancelPrintwayOrder, deletePrintwayOrder } = await import("@/lib/printway-api");
          const isPwId = /^PW/i.test(ffo.externalFfId);
          const [ord] = await db.select({ externalId: schema.orders.externalId, orderLabel: schema.orders.orderLabel }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
          const p = { pwOrderId: isPwId ? ffo.externalFfId : undefined, orderName: (ord?.orderLabel || ord?.externalId || (!isPwId ? ffo.externalFfId : "")) || undefined };
          let r = await cancelPrintwayOrder({ accessToken, endpoint: ff.apiEndpoint }, p);
          if (!r.ok) r = await deletePrintwayOrder({ accessToken, endpoint: ff.apiEndpoint }, p);
          notes.push(`${ff.name}: ${r.ok ? "cancelled" : r.message}`);
        } else if (name.includes("flashship")) {
          const { cancelFlashshipOrders } = await import("@/lib/flashship");
          const r = await cancelFlashshipOrders({ accessToken, endpoint: ff.apiEndpoint }, [ffo.externalFfId], "Cancelled from FUSION OS");
          notes.push(`${ff.name}: ${r.ok ? "cancelled" : r.message}`);
        } else if (name.includes("onos")) {
          const { cancelOnosOrder } = await import("@/lib/onos");
          const r = await cancelOnosOrder({ apiKey: accessToken, endpoint: ff.apiEndpoint }, ffo.externalFfId);
          notes.push(`${ff.name}: ${r.ok ? "cancelled" : r.message}`);
        } else if (name.includes("wembroidery")) {
          const { cancelWembroideryOrder } = await import("@/lib/wembroidery");
          await cancelWembroideryOrder({ apiKey: accessToken, endpoint: ff.apiEndpoint }, ffo.externalFfId, "Cancelled from FUSION OS");
          notes.push(`${ff.name}: cancelled`);
        } else continue; // nhà khác chưa có API cancel → chỉ đánh dấu local
      } catch (e) {
        notes.push(`${ff.name}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      }
      try { await db.update(schema.fulfillmentOrders).set({ status: "cancelled" }).where(eq(schema.fulfillmentOrders.id, ffo.id)); } catch { /* */ }
    }
  } catch { /* best-effort */ }
  return notes;
}
