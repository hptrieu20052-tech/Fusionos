import { db, schema } from "@/lib/db";
import { and, eq, like, notInArray } from "drizzle-orm";
import { getPrintifyOrder } from "@/lib/printify";
import { syncOrderFromFf, markShippedOnTracking, refundOrderCost, rebalanceOrderCost } from "@/lib/order-status";
import { autoPushEtsyTracking } from "@/lib/etsy-tracking";

/**
 * POLL PRINTIFY (backup cho webhook).
 *
 * Vì sao cần: chi phí thật + tracking của Printify chỉ về qua webhook. Webhook được đăng ký
 * MỘT LẦN cho từng shop — đổi API token / shop id là shop mới KHÔNG có webhook → đơn đứng $0
 * và không bao giờ có tracking. Poll này gọi thẳng GET /shops/{shop}/orders/{id}.json nên
 * luôn lấy được, kể cả khi webhook chết.
 *
 * Printify trả tiền ở đơn vị CENT: total_price / total_shipping / total_tax.
 */
export async function syncPrintify(opts: { force?: boolean } = {}) {
  const fulfillers = await db.select().from(schema.fulfillers);
  const pfs = fulfillers.filter((f) => f.name.toLowerCase().includes("printify"));
  let updated = 0, costed = 0, checked = 0, skipped = 0;
  const errors: string[] = [];

  for (const ff of pfs) {
    const cred = (ff.credentials ?? {}) as Record<string, unknown>;
    const token = (cred.apiKey || cred.apiToken) as string | undefined;
    const shopId = cred.shopId as string | number | undefined;
    if (!token || !shopId) { skipped++; continue; }

    // Throttle 10 phút / fulfiller (trừ khi force)
    const last = Date.parse(String(cred.printifySyncAt ?? "")) || 0;
    if (!opts.force && Date.now() - last < 10 * 60_000) { skipped++; continue; }
    await db.update(schema.fulfillers).set({ credentials: { ...cred, printifySyncAt: new Date().toISOString() } }).where(eq(schema.fulfillers.id, ff.id));

    const open = await db.select({
      id: schema.fulfillmentOrders.id, orderId: schema.fulfillmentOrders.orderId,
      externalFfId: schema.fulfillmentOrders.externalFfId, status: schema.fulfillmentOrders.status,
      tracking: schema.fulfillmentOrders.trackingNumber, cost: schema.fulfillmentOrders.cost,
    }).from(schema.fulfillmentOrders).where(and(
      eq(schema.fulfillmentOrders.fulfillerId, ff.id),
      notInArray(schema.fulfillmentOrders.status, ["delivered", "cancelled", "error"] as never),
    ));

    for (const x of open.slice(0, 40)) {
      const pid = x.externalFfId;
      if (!pid || pid.startsWith("SIM-")) continue;
      checked++;
      try {
        const o = (await getPrintifyOrder(token, shopId, pid)) as Record<string, unknown>;
        const N = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
        const statusRaw = String(o.status ?? "").toLowerCase();

        // tracking: shipments[0] hoặc printify_connect
        const ships = (Array.isArray(o.shipments) ? o.shipments : []) as Record<string, unknown>[];
        const sh = ships[0] ?? {};
        const tracking = String(sh.number ?? "");
        const carrier = String(sh.carrier ?? "");
        const trackingUrl = String(sh.url ?? "");

        // QUY TẮC CHUNG: Push → pushed · ĐÃ TRẢ TIỀN → in_production · CÓ TRACKING → shipped.
        const isCancel = /cancel/.test(statusRaw);
        const ffStatus = isCancel ? "cancelled"
          : /deliver/.test(statusRaw) ? "delivered"
          : (tracking || /^shipped$/.test(statusRaw)) ? "shipped"
          : /in-production|in_production|sending|fulfilled|has-issues|payment-processing/.test(statusRaw) ? "in_production"
          : "";

        const patch: Record<string, unknown> = {};
        if (ffStatus && ffStatus !== x.status) patch.status = ffStatus;
        if (tracking && tracking !== x.tracking) {
          patch.trackingNumber = tracking;
          patch.trackingCarrier = carrier || null;
          patch.trackingUrl = trackingUrl || null;
          patch.trackingSyncedAt = new Date();
        }

        // ---- CHI PHÍ THẬT (Printify trả CENT) — công thức GIỐNG HỆT webhook printify ----
        const li = (Array.isArray(o.line_items) ? o.line_items : []) as Record<string, unknown>[];
        const baseC = li.reduce((a, it) => a + N(it.cost), 0);
        const shipC = N(o.total_shipping) || li.reduce((a, it) => a + N(it.shipping_cost), 0);
        const taxC = N(o.total_tax);
        const grand = Math.round((baseC + shipC + taxC)) / 100;

        const priced = grand > 0 && !isCancel;
        if (priced && Math.abs(Number(x.cost ?? 0) - grand) >= 0.005) {
          patch.baseCost = (baseC / 100).toFixed(2);
          patch.shipCost = (shipC / 100).toFixed(2);
          patch.extraFee = (taxC / 100).toFixed(2);
          patch.cost = grand.toFixed(2);
        }

        if (Object.keys(patch).length) {
          await db.update(schema.fulfillmentOrders).set(patch).where(eq(schema.fulfillmentOrders.id, x.id));
          if (ffStatus) await syncOrderFromFf(x.orderId, ffStatus);
          if (patch.trackingNumber) {
            await markShippedOnTracking(x.orderId);
            await autoPushEtsyTracking(x.orderId);
          }
          if (isCancel) {
            await db.update(schema.fulfillmentOrders).set({ baseCost: "0", shipCost: "0", extraFee: "0", cost: "0" }).where(eq(schema.fulfillmentOrders.id, x.id));
            await refundOrderCost(x.orderId, "Refund cost — cancelled by Printify");
          }
          updated++;
        }

        // ---- SỔ: chạy MỖI LẦN (kể cả khi ffo đã có cost) vì bút toán base_cost có thể
        // đang thiếu/lệch (bị xoá khi undo push, hoặc lúc đẩy chỉ ghi 0). ----
        if (priced) {
          // 1) Sửa đúng dòng của bản ghi đẩy này (note lúc đẩy có chứa external_ff_id)
          await db.update(schema.transactions).set({ amount: (-grand).toFixed(2) }).where(and(
            eq(schema.transactions.orderId, x.orderId),
            eq(schema.transactions.type, "base_cost"),
            like(schema.transactions.note, `%${pid}%`),
          ));
          // 2) Cân lại tổng: nếu chưa có dòng nào (đã bị xoá) thì rebalance sẽ CHÈN cho đủ.
          if (await rebalanceOrderCost(x.orderId, `Printify · ${pid} — cost sync`)) costed++;
        }
      } catch (e) {
        errors.push(`${ff.name} ${pid}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      }
    }
  }
  return { ok: errors.length === 0, updated, costed, checked, skipped, errors };
}
