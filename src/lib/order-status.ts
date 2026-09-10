import { db, schema } from "@/lib/db";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";

// ---------- v460 · GỘP ĐẨY (merge fulfillment) ----------
// 1 bản ghi fulfillment có thể gánh item của NHIỀU đơn FUSION (đơn Shopify tách CLONE theo seller,
// fulfiller đẩy chung 1 lần cho supplier để tiết kiệm ship). merged_order_ids = các đơn anh em bị gộp.
// Mọi helper trạng thái/chi phí dưới đây phải nhìn cả bản ghi "phủ" đơn (orderId trùng HOẶC bị gộp vào).

/** Điều kiện SQL: bản ghi đẩy PHỦ đơn này (chính chủ hoặc bị gộp vào). */
const coveringFf = (orderId: string) => or(
  eq(schema.fulfillmentOrders.orderId, orderId),
  sql`${schema.fulfillmentOrders.mergedOrderIds} @> ${JSON.stringify([orderId])}::jsonb`,
);

/** Đơn chính + mọi đơn bị gộp trong các bản ghi đẩy CỦA đơn chính. */
async function mergedFamily(orderId: string): Promise<string[]> {
  const ids = new Set([orderId]);
  try {
    const ffs = await db.select({ merged: schema.fulfillmentOrders.mergedOrderIds })
      .from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.orderId, orderId));
    for (const f of ffs) if (Array.isArray(f.merged)) for (const x of f.merged as unknown[]) { const v = String(x); if (v) ids.add(v); }
  } catch { /* best-effort */ }
  return Array.from(ids);
}

/**
 * Phần chi phí của 1 đơn trong 1 bản ghi đẩy.
 * Bản thường → đơn chính chịu 100%. Bản GỘP → chia theo cost mapping (base+ship) của line từng đơn
 * (trùng cách chia lúc push); mapping thiếu/đổi giá → fallback chia theo SỐ LINE.
 */
async function ffShareOf(orderId: string, ffo: { orderId: string; cost: string | null; lines: unknown; mergedOrderIds: unknown }): Promise<number> {
  const total = Number(ffo.cost ?? 0);
  const merged = Array.isArray(ffo.mergedOrderIds) && (ffo.mergedOrderIds as unknown[]).length > 0;
  if (!merged) return ffo.orderId === orderId ? total : 0;
  const lines = (Array.isArray(ffo.lines) ? ffo.lines : []) as { mappingId?: string; qty?: number; fromOrderId?: string }[];
  if (!lines.length) return ffo.orderId === orderId ? total : 0;
  const mine = lines.filter((l) => (l.fromOrderId ?? ffo.orderId) === orderId);
  if (!mine.length) return 0;
  const mapIds = Array.from(new Set(lines.map((l) => l.mappingId).filter(Boolean))) as string[];
  const maps = mapIds.length
    ? await db.select({ id: schema.skuMappings.id, baseCost: schema.skuMappings.baseCost, shipCost: schema.skuMappings.shipCost })
        .from(schema.skuMappings).where(inArray(schema.skuMappings.id, mapIds))
    : [];
  const unit = new Map(maps.map((m) => [m.id, Number(m.baseCost) + Number(m.shipCost)]));
  const w = (ls: typeof lines) => ls.reduce((a, l) => a + (unit.get(l.mappingId ?? "") ?? 0) * (Number(l.qty) || 1), 0);
  const tw = w(lines);
  const ratio = tw > 0 ? w(mine) / tw : mine.length / lines.length;
  return Math.round(total * ratio * 100) / 100;
}

// Khi đơn có tracking (webhook fulfiller trả về / nhập tay / import) → tự chuyển sang "shipped".
// Chỉ nâng từ các trạng thái trước đó; KHÔNG đụng đơn đã shipped/delivered/trash/cancel.
// ĐƠN TÁCH NHIỀU NHÀ IN: chỉ Shipped khi TẤT CẢ bản ghi fulfill đã có tracking
// (1 bản ghi = hành vi cũ; tránh đơn 2 nhà mới ship nửa đã báo khách "đã giao hết").
export async function markShippedOnTracking(orderId: string) {
  try {
    // v460: xét cả đơn anh em bị GỘP vào bản ghi đẩy của đơn này; mỗi đơn kiểm theo bản ghi PHỦ nó.
    for (const id of await mergedFamily(orderId)) {
      const ffs = await db.select({ tn: schema.fulfillmentOrders.trackingNumber })
        .from(schema.fulfillmentOrders).where(coveringFf(id));
      if (ffs.length > 1 && ffs.some((f) => !f.tn)) continue; // còn nhà chưa trả tracking → chưa Shipped
      await db.update(schema.orders)
        .set({ status: "shipped" })
        .where(and(
          eq(schema.orders.id, id),
          inArray(schema.orders.status, ["new", "created", "in_production", "has_issues"] as never),
        ));
    }
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
    // v460: trạng thái nhà in lan sang CẢ đơn anh em bị gộp chung lần đẩy (cùng 1 kiện hàng thật).
    const ids = await mergedFamily(orderId);
    await db.update(schema.orders).set({ status: m.target as never })
      .where(and(inArray(schema.orders.id, ids), inArray(schema.orders.status, m.prev as never)));
    if (ffStatus === "cancelled") for (const id of ids) await refundOrderCost(id, "Refund cost — cancelled by fulfiller");
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
    // v166: XOÁ SẠCH thay vì chèn dòng bù +X.
    // Cách cũ để lại 2 dòng cộng lại = 0; nhiều luồng khác xoá bút toán theo `note LIKE %external_ff_id%`
    // (dòng bù không chứa ff id) nên hay bỏ sót → sổ hiện cost ÂM. Đơn huỷ thì chi phí phải bằng 0
    // và KHÔNG còn bút toán nào cả — sạch, không bẫy.
    void note;
    await db.delete(schema.transactions).where(and(
      eq(schema.transactions.orderId, orderId),
      eq(schema.transactions.type, "base_cost"),
    ));
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
export async function rebalanceOrderCost(orderId: string, note = "Cost adjustment — rebalance"): Promise<boolean> {
  try {
    // v460: cost thật đổi (webhook/poll) → cân lại sổ cho CẢ cụm đơn gộp, mỗi đơn đúng PHẦN của mình.
    const fam = await mergedFamily(orderId);
    let any = false;
    for (const id of fam) any = (await rebalanceOne(id, note)) || any;
    return any;
  } catch { return false; }
}

async function rebalanceOne(orderId: string, note: string): Promise<boolean> {
  try {
    const ffos = await db.select({
      cost: schema.fulfillmentOrders.cost, status: schema.fulfillmentOrders.status,
      orderId: schema.fulfillmentOrders.orderId, lines: schema.fulfillmentOrders.lines,
      mergedOrderIds: schema.fulfillmentOrders.mergedOrderIds,
    }).from(schema.fulfillmentOrders).where(coveringFf(orderId));
    let target = 0;
    for (const r of ffos.filter((r) => r.status !== "cancelled")) target -= await ffShareOf(orderId, r);
    target = Math.round(target * 100) / 100;
    const cur = Number(((await db.execute(sql`
      SELECT coalesce(sum(amount),0)::numeric s FROM transactions WHERE order_id = ${orderId}::uuid AND type = 'base_cost'
    `)).rows[0] as { s: string }).s);

    // Số DÒNG base_cost đang có — cần để bắt ca "tổng đúng nhưng nằm rải ở nhiều dòng".
    const nRows = Number(((await db.execute(sql`
      SELECT count(*)::int n FROM transactions WHERE order_id = ${orderId}::uuid AND type = 'base_cost'
    `)).rows[0] as { n: number }).n);

    if (Math.abs(cur - target) < 0.005 && nRows <= 1) return false; // đã khớp tới cent VÀ gọn 1 dòng
    // GHI ĐÈ, KHÔNG CỘNG DỒN (v166).
    // BUG CŨ: đọc tổng hiện tại `cur` rồi CHÈN THÊM dòng chênh lệch (target − cur). Chỉ đúng nếu
    // `cur` đọc được chính xác; thực tế poll Compassup chạy lại nhiều vòng đã chèn NGUYÊN số tiền
    // mỗi lần → sổ gấp 2×/3×/5× chi phí thật (đơn 4118710879: 4 dòng −38.61 cùng note
    // "Compassup · … — cost poll" trong khi ffo cost chỉ 38.61).
    // base_cost là số DẪN XUẤT từ fulfillment_orders → luôn tái tạo được. Nên xoá sạch rồi ghi lại
    // ĐÚNG 1 dòng: idempotent tuyệt đối, chạy bao nhiêu lần kết quả vẫn thế, không phụ thuộc `cur`.
    await db.delete(schema.transactions).where(and(
      eq(schema.transactions.orderId, orderId),
      eq(schema.transactions.type, "base_cost"),
    ));
    if (Math.abs(target) < 0.005) return true; // không còn bản ghi đẩy nào có chi phí → sổ về rỗng
    const [ord] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
    await db.insert(schema.transactions).values({
      type: "base_cost", amount: target.toFixed(2),
      // Cost ghi cho CHỦ SHOP LÚC ĐƠN VỀ để nằm cùng chỗ với doanh thu (xem fulfillment/push).
      orderId, storeId: ord?.storeId ?? null, sellerId: ord?.sellerAtOrder ?? ord?.sellerId ?? null,
      note,
      // Theo NGÀY KÉO ĐƠN VỀ (ordered_at) để cost trùng mốc doanh thu.
      occurredAt: (ord?.orderedAt ? new Date(ord.orderedAt) : new Date()).toISOString().slice(0, 10),
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
      // v460 · bản ghi GỘP nhiều đơn: kiện supplier còn item của ĐƠN KHÁC → không tự huỷ nguyên kiện.
      if (Array.isArray(ffo.mergedOrderIds) && (ffo.mergedOrderIds as unknown[]).length) {
        notes.push(`${ffo.externalFfId}: lần đẩy GỘP nhiều đơn — không tự huỷ ở supplier (còn item đơn khác), cần xử lý tay`);
        continue;
      }
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
