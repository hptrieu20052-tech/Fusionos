import { db, schema } from "@/lib/db";
import { and, eq, inArray, isNotNull, like, notInArray } from "drizzle-orm";
import { syncOrderFromFf, markShippedOnTracking, refundOrderCost } from "@/lib/order-status";
import { autoPushEtsyTracking } from "@/lib/etsy-tracking";
import { getOnosOrder, mapOnosStatus } from "@/lib/onos";
import { getWembroideryOrder, mapWemStatus } from "@/lib/wembroidery";
import { getMerchizeTracking, extractMerchizeTracking } from "@/lib/merchize";
import { getFlashshipOrdersByCodes, mapFsStatus } from "@/lib/flashship";

/**
 * POLL BACKUP trạng thái + tracking cho MERCHIZE · FLASHSHIP · ONOS · WEMBROIDERY.
 * (Printway có poll riêng printway-sync; Printify webhook đã ổn định.)
 * Webhook vẫn là kênh chính — poll đảm bảo KHÔNG LỠ cancel/tracking khi webhook không bắn
 * (vd: cancel tay trên web supplier, webhook chưa đăng ký, hoặc payload lạ).
 * Quét ffo chưa kết thúc → đọc trạng thái từ supplier → cập nhật; CANCEL thì hoàn cost + đơn về Cancel.
 * Throttle 10'/fulfiller (credentials.pollSyncAt) — cron gọi dày cũng an toàn.
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

  // ---- ĐƠN BỊ HUỶ bên supplier → hoàn cost + đơn về Cancel (giống flow webhook Merchize/Printify) ----
  if (upd.status === "cancelled") {
    if (ffo.externalFfId) {
      await db.delete(schema.transactions).where(and(
        eq(schema.transactions.orderId, ffo.orderId),
        eq(schema.transactions.type, "base_cost"),
        like(schema.transactions.note, `%${ffo.externalFfId}%`),
      ));
    }
    await db.update(schema.fulfillmentOrders).set({ status: "cancelled" as never, baseCost: "0", shipCost: "0", extraFee: "0", cost: "0" })
      .where(eq(schema.fulfillmentOrders.id, ffo.id));
    await db.update(schema.orders).set({ status: "cancel" as never, updatedAt: new Date() }).where(eq(schema.orders.id, ffo.orderId));
    await refundOrderCost(ffo.orderId, "Refund cost — cancelled at supplier (poll)");
    return true;
  }

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
    await db.update(schema.orders).set({ status: "shipped" as never, updatedAt: new Date() })
      .where(and(eq(schema.orders.id, ffo.orderId), inArray(schema.orders.status, ["new", "created", "in_production"] as never[])));
  } else if (upd.status === "in_production") {
    await db.update(schema.orders).set({ status: "in_production" as never, updatedAt: new Date() })
      .where(and(eq(schema.orders.id, ffo.orderId), inArray(schema.orders.status, ["new", "created"] as never[])));
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

// Map trạng thái Merchize (poll tracking endpoint) → ffo
function mapMerchizeStatus(raw: string, hasTracking: boolean): string {
  const s = (raw || "").toLowerCase();
  if (/cancel|refund/.test(s)) return "cancelled";
  if (/deliver|complete/.test(s)) return "delivered";
  if (/ship|transit|fulfil/.test(s) || hasTracking) return "shipped";
  if (/produc|process|paid/.test(s)) return "in_production";
  return "";
}

export async function syncOnosWem(opts: { force?: boolean } = {}) {
  const fulfillers = await db.select().from(schema.fulfillers);
  let updated = 0, checked = 0, skipped = 0;
  const errors: string[] = [];
  const BATCH = 5, BUDGET_MS = 22000;
  const started = Date.now();

  for (const ff of fulfillers) {
    const name = ff.name.toLowerCase();
    const kind = name.includes("onos") ? "onos"
      : name.includes("wembroidery") ? "wem"
      : name.includes("merchize") ? "merchize"
      : name.includes("flashship") ? "flashship" : null;
    if (!kind) continue;
    const cred = (ff.credentials ?? {}) as Record<string, string>;
    const apiKey = cred.apiKey || cred.accessToken || cred.apiToken;
    if (!apiKey) { skipped++; continue; }
    if (await throttled(ff, !!opts.force)) { skipped++; continue; }

    const open = (await openFfosOf(ff.id)).filter((f) => !f.externalFfId?.startsWith("SIM-") && !f.externalFfId?.startsWith("MANUAL-"));
    const api = { apiKey, endpoint: ff.apiEndpoint };

    if (kind === "flashship") {
      // FlashShip: batch 20 code/lần — rẻ, nhanh
      for (let i = 0; i < open.length; i += 20) {
        if (Date.now() - started > BUDGET_MS) break;
        const batch = open.slice(i, i + 20);
        try {
          const details = await getFlashshipOrdersByCodes({ accessToken: apiKey, endpoint: ff.apiEndpoint }, batch.map((f) => f.externalFfId!));
          checked += batch.length;
          for (const d of details) {
            const ffo = batch.find((f) => f.externalFfId === d.order_code);
            if (!ffo) continue;
            const hasTrack = !!(d.tracking_number || ffo.trackingNumber);
            const st = mapFsStatus(d.status, d.tracking_status, hasTrack) || ffo.status;
            if (await applyUpdate(ffo, { status: st, trackingNumber: d.tracking_number || undefined, carrier: d.carrier || undefined })) updated++;
          }
        } catch (e) { if (errors.length < 5) errors.push(`${ff.name}: ${String((e as Error)?.message ?? e).slice(0, 120)}`); }
      }
      continue;
    }

    for (let i = 0; i < open.length; i += BATCH) {
      if (Date.now() - started > BUDGET_MS) break;
      await Promise.all(open.slice(i, i + BATCH).map(async (ffo) => {
        try {
          checked++;
          if (kind === "onos") {
            const raw = await getOnosOrder(api, ffo.externalFfId!);
            const d = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
            const tr = (d.tracking && typeof d.tracking === "object" ? d.tracking : {}) as Record<string, unknown>;
            const trackingNumber = S(d.tracking_number ?? tr.tracking_number ?? d.trackingNumber);
            const carrier = S(d.carrier ?? tr.carrier ?? d.carrier_code);
            const status = mapOnosStatus(S(d.status ?? d.order_status), !!(trackingNumber || ffo.trackingNumber));
            if (await applyUpdate(ffo, { status, trackingNumber: trackingNumber || undefined, carrier: carrier || undefined })) updated++;
          } else if (kind === "wem") {
            const raw = await getWembroideryOrder(api, ffo.externalFfId!);
            const root = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
            const order = (root.order && typeof root.order === "object" ? root.order : root) as Record<string, unknown>;
            const pkgs = arrOf(root.orderPackages ?? (order as Record<string, unknown>).orderPackages);
            const withTrack = pkgs.find((p) => S(p.trackingNumber));
            const trackingNumber = S(withTrack?.trackingNumber);
            const carrier = S(withTrack?.carrierCode ?? withTrack?.carrier);
            const status = mapWemStatus(S(order.status), !!(trackingNumber || ffo.trackingNumber));
            if (await applyUpdate(ffo, { status, trackingNumber: trackingNumber || undefined, carrier: carrier || undefined })) updated++;
          } else {
            // Merchize: endpoint tracking trả kèm status (cancel/fulfilled/...)
            const baseUrl = ff.apiEndpoint?.trim() || "https://bo-group-2.merchize.com/hgu3s";
            const raw = await getMerchizeTracking(baseUrl, apiKey, { code: ffo.externalFfId! });
            const t = extractMerchizeTracking(raw);
            const status = mapMerchizeStatus(t.status ?? "", !!(t.trackingNumber || ffo.trackingNumber)) || ffo.status;
            if (await applyUpdate(ffo, { status, trackingNumber: t.trackingNumber, trackingUrl: t.trackingUrl, carrier: t.carrier })) updated++;
          }
        } catch (e) {
          if (errors.length < 5) errors.push(`${ff.name} ${ffo.externalFfId}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
        }
      }));
    }
  }
  return { ok: true, checked, updated, skipped, errors: errors.length ? errors : undefined };
}
