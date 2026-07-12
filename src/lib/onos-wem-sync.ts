import { db, schema } from "@/lib/db";
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { syncOrderFromFf, markShippedOnTracking } from "@/lib/order-status";
import { autoPushEtsyTracking } from "@/lib/etsy-tracking";
import { getOnosOrder, mapOnosStatus } from "@/lib/onos";
import { getWembroideryOrder, mapWemStatus } from "@/lib/wembroidery";

/**
 * POLL BACKUP cho ONOS + Wembroidery — kênh chính là webhook, nhưng payload/headers webhook
 * 2 nhà này chưa được test với đơn thật → poll đảm bảo tracking/status KHÔNG BAO GIỜ bị lỡ.
 * Quét các bản ghi đẩy chưa kết thúc (pending/pushed/in_production), gọi chi tiết đơn từng cái,
 * cập nhật tracking + status. Throttle 10'/fulfiller (credentials.pollSyncAt) — cron gọi dày cũng an toàn.
 */

const S = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const arrOf = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

type OpenFfo = { id: string; orderId: string; externalFfId: string | null; status: string; trackingNumber: string | null };

async function openFfosOf(fulfillerId: string): Promise<OpenFfo[]> {
  return db.select({
    id: schema.fulfillmentOrders.id, orderId: schema.fulfillmentOrders.orderId,
    externalFfId: schema.fulfillmentOrders.externalFfId, status: schema.fulfillmentOrders.status,
    trackingNumber: schema.fulfillmentOrders.trackingNumber,
  }).from(schema.fulfillmentOrders).where(and(
    eq(schema.fulfillmentOrders.fulfillerId, fulfillerId),
    isNotNull(schema.fulfillmentOrders.externalFfId),
    notInArray(schema.fulfillmentOrders.status, ["delivered", "cancelled", "error"]),
  ));
}

async function applyUpdate(ffo: OpenFfo, upd: { status: string; trackingNumber?: string; trackingUrl?: string; carrier?: string }): Promise<boolean> {
  const changed = upd.status !== ffo.status || (upd.trackingNumber && upd.trackingNumber !== ffo.trackingNumber);
  if (!changed) return false;
  await db.update(schema.fulfillmentOrders).set({
    status: upd.status as never,
    trackingNumber: upd.trackingNumber || undefined,
    trackingUrl: upd.trackingUrl || undefined,
    trackingCarrier: upd.carrier || undefined,
    trackingSyncedAt: upd.trackingNumber ? new Date() : undefined,
  }).where(eq(schema.fulfillmentOrders.id, ffo.id));
  await syncOrderFromFf(ffo.orderId, upd.status);
  if (upd.trackingNumber && upd.trackingNumber !== ffo.trackingNumber) {
    await autoPushEtsyTracking(ffo.orderId);
    await markShippedOnTracking(ffo.orderId);
  }
  if (upd.trackingNumber || upd.status === "shipped") {
    await db.update(schema.orders).set({ status: "shipped", updatedAt: new Date() })
      .where(and(eq(schema.orders.id, ffo.orderId), inArray(schema.orders.status, ["new", "created", "in_production"])));
  } else if (upd.status === "in_production") {
    await db.update(schema.orders).set({ status: "in_production", updatedAt: new Date() })
      .where(and(eq(schema.orders.id, ffo.orderId), inArray(schema.orders.status, ["new", "created"])));
  }
  return true;
}

// Throttle chung theo fulfiller — ghi mốc vào credentials.pollSyncAt
async function throttled(ff: typeof schema.fulfillers.$inferSelect, force: boolean): Promise<boolean> {
  const cred = (ff.credentials ?? {}) as Record<string, unknown>;
  const last = Date.parse(String(cred.pollSyncAt ?? "")) || 0;
  if (!force && Date.now() - last < 10 * 60_000) return true;
  await db.update(schema.fulfillers).set({ credentials: { ...cred, pollSyncAt: new Date().toISOString() } }).where(eq(schema.fulfillers.id, ff.id));
  return false;
}

export async function syncOnosWem(opts: { force?: boolean } = {}) {
  const fulfillers = await db.select().from(schema.fulfillers);
  let updated = 0, checked = 0, skipped = 0;
  const errors: string[] = [];
  const BATCH = 5, BUDGET_MS = 20000;
  const started = Date.now();

  for (const ff of fulfillers) {
    const name = ff.name.toLowerCase();
    const isOnos = name.includes("onos");
    const isWem = name.includes("wembroidery");
    if (!isOnos && !isWem) continue;
    const cred = (ff.credentials ?? {}) as Record<string, string>;
    const apiKey = cred.apiKey || cred.accessToken || cred.apiToken;
    if (!apiKey) { skipped++; continue; }
    if (await throttled(ff, !!opts.force)) { skipped++; continue; }

    const open = await openFfosOf(ff.id);
    const api = { apiKey, endpoint: ff.apiEndpoint };
    for (let i = 0; i < open.length; i += BATCH) {
      if (Date.now() - started > BUDGET_MS) break;
      await Promise.all(open.slice(i, i + BATCH).map(async (ffo) => {
        try {
          checked++;
          if (isOnos) {
            // ONOS: GET /order/{id} — dò status + tracking phòng thủ nhiều tên field
            const raw = await getOnosOrder(api, ffo.externalFfId!);
            const d = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
            const tr = (d.tracking && typeof d.tracking === "object" ? d.tracking : {}) as Record<string, unknown>;
            const trackingNumber = S(d.tracking_number ?? tr.tracking_number ?? d.trackingNumber);
            const carrier = S(d.carrier ?? tr.carrier ?? d.carrier_code);
            const rawStatus = S(d.status ?? d.order_status);
            const status = mapOnosStatus(rawStatus, !!(trackingNumber || ffo.trackingNumber));
            if (await applyUpdate(ffo, { status, trackingNumber: trackingNumber || undefined, carrier: carrier || undefined })) updated++;
          } else {
            // Wembroidery: GET /orders/{id} — status ở order, tracking ở orderPackages (theo docs)
            const raw = await getWembroideryOrder(api, ffo.externalFfId!);
            const root = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
            const order = (root.order && typeof root.order === "object" ? root.order : root) as Record<string, unknown>;
            const pkgs = arrOf(root.orderPackages ?? (order as Record<string, unknown>).orderPackages);
            const withTrack = pkgs.find((p) => S(p.trackingNumber));
            const trackingNumber = S(withTrack?.trackingNumber);
            const carrier = S(withTrack?.carrierCode ?? withTrack?.carrier);
            const rawStatus = S(order.status);
            const status = mapWemStatus(rawStatus, !!(trackingNumber || ffo.trackingNumber));
            if (await applyUpdate(ffo, { status, trackingNumber: trackingNumber || undefined, carrier: carrier || undefined })) updated++;
          }
        } catch (e) {
          if (errors.length < 5) errors.push(`${ff.name} ${ffo.externalFfId}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
        }
      }));
    }
  }
  return { ok: true, checked, updated, skipped, errors: errors.length ? errors : undefined };
}
