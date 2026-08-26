import { db, schema } from "@/lib/db";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { listPrintwayOrders, normalizePwOrder, getPrintwayOrderDetail, extractPwTracking } from "@/lib/printway-api";
import { syncPrintwayCost } from "@/lib/printway-cost";
import { rebalanceOrderCost } from "@/lib/order-status";
import { syncOrderFromFf, markShippedOnTracking } from "@/lib/order-status";
import { autoPushEtsyTracking } from "@/lib/etsy-tracking";
import { autoPushTiktokTracking } from "@/lib/tiktok-tracking";
import { autoPushShopifyTracking } from "@/lib/shopify";
import { FF_POLL_THROTTLE_MS } from "@/lib/fulfillers";

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
    if (!opts.force && Date.now() - last < FF_POLL_THROTTLE_MS) { skipped++; continue; }
    await db.update(schema.fulfillers).set({ credentials: { ...cred, printwaySyncAt: new Date().toISOString() } }).where(eq(schema.fulfillers.id, ff.id));

    // Các bản ghi đẩy Printway chưa kết thúc
    const open = await db.select({
      id: schema.fulfillmentOrders.id, orderId: schema.fulfillmentOrders.orderId,
      externalFfId: schema.fulfillmentOrders.externalFfId, status: schema.fulfillmentOrders.status,
      tracking: schema.fulfillmentOrders.trackingNumber, cost: schema.fulfillmentOrders.cost,
      pushedAt: schema.fulfillmentOrders.pushedAt,
    }).from(schema.fulfillmentOrders).where(and(
      eq(schema.fulfillmentOrders.fulfillerId, ff.id),
      notInArray(schema.fulfillmentOrders.status, ["delivered", "cancelled", "error"] as never),
    ));
    const byName = new Map(open.filter((x) => x.externalFfId && !x.externalFfId.startsWith("SIM-")).map((x) => [x.externalFfId as string, x]));
    if (!byName.size) continue;
    const gotTracking = new Set<string>(); // ffo.id đã set tracking từ list → khỏi gọi detail lại

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
            gotTracking.add(hit.id);
            await markShippedOnTracking(hit.orderId);
            await autoPushEtsyTracking(hit.orderId);
            await autoPushTiktokTracking(hit.orderId); await autoPushShopifyTracking(hit.orderId);
          }
          updated++;
        }
        if (items.length < 50) break;
      }
    } catch (e) {
      errors.push(`${ff.name}: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
    }

    // TRACKING qua /order/detail (backup của backup): /transaction/order-list có thể KHÔNG kèm
    // trackings[]. Printway (schema 2026) gán tracking ngay khi IN, nằm trong trackings[] của
    // /order/detail. Với đơn còn mở mà FUSION chưa có tracking → gọi detail rồi bóc. Cap 25/lần.
    // v357 · BỎ giới hạn cứng 25 (gây "đói" đơn mới khi tồn nhiều đơn chưa tracking → đơn cũ chiếm 25 chỗ đầu,
    // đơn mới không bao giờ tới lượt). Quét TẤT CẢ đơn còn mở chưa tracking, ƯU TIÊN MỚI NHẤT (pushedAt desc),
    // dừng khi gần hết thời gian (route maxDuration 60s) + nghỉ 70ms/call cho an toàn rate limit (50 req/3s).
    const noTrack = open
      .filter((x) => !x.tracking && !gotTracking.has(x.id) && x.externalFfId && !x.externalFfId.startsWith("SIM-"))
      .sort((a, b) => (b.pushedAt?.getTime() ?? 0) - (a.pushedAt?.getTime() ?? 0));
    const trackDeadline = Date.now() + 30_000; // chừa thời gian cho vòng cost + budget cron (maxDuration 60s)
    let trackLeft = 0;
    for (let ti = 0; ti < noTrack.length; ti++) {
      const x = noTrack[ti];
      if (Date.now() > trackDeadline) { trackLeft = noTrack.length - ti; break; }
      try {
        const ffId = x.externalFfId as string;
        const pwId = /^PW/i.test(ffId) ? ffId : undefined;
        const detail = await getPrintwayOrderDetail(
          { accessToken: token, endpoint: ff.apiEndpoint },
          { pwOrderId: pwId, orderName: pwId ? undefined : ffId },
        );
        const tk = extractPwTracking(detail);
        if (tk.tracking && tk.tracking !== x.tracking) {
          await db.update(schema.fulfillmentOrders).set({
            trackingNumber: tk.tracking,
            trackingCarrier: tk.carrier || null,
            trackingUrl: tk.trackingUrl || null,
            trackingSyncedAt: new Date(),
          }).where(eq(schema.fulfillmentOrders.id, x.id));
          await markShippedOnTracking(x.orderId);
          await autoPushEtsyTracking(x.orderId);
          await autoPushTiktokTracking(x.orderId); await autoPushShopifyTracking(x.orderId);
          updated++;
        }
      } catch (e) {
        errors.push(`${ff.name} track ${x.externalFfId}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      }
      await new Promise((r) => setTimeout(r, 70)); // an toàn rate limit Printway (50 req/3s)
    }
    if (trackLeft > 0) errors.push(`${ff.name}: còn ${trackLeft} đơn chưa quét tracking (hết thời gian) — bấm Sync now lần nữa để tiếp tục`);

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
    // Đơn ĐÃ có cost nhưng bút toán có thể thiếu/lệch (bị xoá khi undo push) → cân lại sổ, KHÔNG gọi API.
    for (const x of open.filter((x) => Number(x.cost ?? 0) > 0)) {
      await rebalanceOrderCost(x.orderId, `Printway · ${x.externalFfId ?? ""} — cost sync`);
    }
  }
  return { ok: errors.length === 0, updated, checked, skipped, costed, errors };
}
