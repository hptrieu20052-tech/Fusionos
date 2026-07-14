import { db, schema } from "@/lib/db";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { listPrintwayOrders, normalizePwOrder } from "@/lib/printway-api";
import { syncPrintwayCost } from "@/lib/printway-cost";
import { syncOrderFromFf, markShippedOnTracking } from "@/lib/order-status";
import { autoPushEtsyTracking } from "@/lib/etsy-tracking";

// Kênh chính là webhook (/api/webhooks/printway — đăng ký ở Settings). Poll này là BACKUP:
// quét danh sách đơn 30 ngày gần nhất, khớp theo order_name (= externalFfId mà FUSION gửi
// khi tạo đơn) hoặc pw_order_id, cập nhật trạng thái + tracking nếu webhook bị lỡ.
// Throttle theo fulfiller (credentials.printwaySyncAt) để gọi từ UI không spam API (rate 50req/3s).
export async function syncPrintway(opts: { force?: boolean } = {}) {
  const fulfillers = await db.select().from(schema.fulfillers);
  const pws = fulfillers.filter((f) => f.name.toLowerCase().includes("printway"));
  let updated = 0, checked = 0, skipped = 0, costed = 0;
  const errors: string[] = [];

  for (const ff of pws) {
    const cred = (ff.credentials ?? {}) as Record<string, unknown>;
    const token = (cred.apiKey || cred.accessToken || cred.apiToken) as string | undefined;
    if (!token) { skipped++; continue; }

    // Throttle 10 phút / fulfiller (trừ khi force)
    const last = Date.parse(String(cred.printwaySyncAt ?? "")) || 0;
    if (!opts.force && Date.now() - last < 10 * 60_000) { skipped++; continue; }
    await db.update(schema.fulfillers).set({ credentials: { ...cred, printwaySyncAt: new Date().toISOString() } }).where(eq(schema.fulfillers.id, ff.id));

    // Các bản ghi đẩy Printway chưa kết thúc
    const open = await db.select({
      id: schema.fulfillmentOrders.id, orderId: schema.fulfillmentOrders.orderId,
      externalFfId: schema.fulfillmentOrders.externalFfId, status: schema.fulfillmentOrders.status,
      tracking: schema.fulfillmentOrders.trackingNumber, cost: schema.fulfillmentOrders.cost,
    }).from(schema.fulfillmentOrders).where(and(
      eq(schema.fulfillmentOrders.fulfillerId, ff.id),
      notInArray(schema.fulfillmentOrders.status, ["delivered", "cancelled", "error"] as never),
    ));
    const byName = new Map(open.filter((x) => x.externalFfId && !x.externalFfId.startsWith("SIM-")).map((x) => [x.externalFfId as string, x]));
    if (!byName.size) continue;

    try {
      // Kéo tối đa 4 trang x 50 đơn (đủ cho 30 ngày vận hành thường)
      for (let page = 1; page <= 4; page++) {
        const { items } = await listPrintwayOrders({ accessToken: token, endpoint: ff.apiEndpoint }, { page, limit: 50 });
        if (!items.length) break;
        for (const it of items) {
          const n = normalizePwOrder(it);
          const hit = (n.orderName && byName.get(n.orderName)) || (n.pwId && byName.get(n.pwId)) || null;
          if (!hit) continue;
          checked++;
          const patch: Record<string, unknown> = {};
          if (n.ffStatus && n.ffStatus !== hit.status) patch.status = n.ffStatus;
          if (n.tracking && n.tracking !== hit.tracking) {
            patch.trackingNumber = n.tracking;
            patch.trackingCarrier = n.carrier || null;
            patch.trackingUrl = n.trackingUrl || null;
            patch.trackingSyncedAt = new Date();
          }
          if (!Object.keys(patch).length) continue;
          await db.update(schema.fulfillmentOrders).set(patch).where(eq(schema.fulfillmentOrders.id, hit.id));
          if (n.ffStatus) await syncOrderFromFf(hit.orderId, n.ffStatus);
          if (patch.trackingNumber) {
            await markShippedOnTracking(hit.orderId);
            await autoPushEtsyTracking(hit.orderId);
          }
          updated++;
        }
        if (items.length < 50) break;
      }
    } catch (e) {
      errors.push(`${ff.name}: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
    }

    // GIÁ THẬT: webhook/list của Printway không mang tiền → gọi /order/detail cho các đơn còn $0.
    // Giá chỉ chốt sau khi đơn được PAID bên Printway, nên phải quét lại (không chỉ lúc đẩy).
    const noCost = open.filter((x) => Number(x.cost ?? 0) <= 0).slice(0, 25); // chặn 25 đơn/lần (rate 50req/3s)
    for (const x of noCost) {
      try {
        if (await syncPrintwayCost({ accessToken: token, endpoint: ff.apiEndpoint }, x)) costed++;
      } catch (e) {
        errors.push(`${ff.name} cost ${x.externalFfId}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      }
    }
  }
  return { ok: errors.length === 0, updated, checked, skipped, costed, errors };
}
