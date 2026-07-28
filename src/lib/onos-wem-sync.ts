import { db, schema } from "@/lib/db";
import { and, eq, inArray, isNotNull, like, notInArray } from "drizzle-orm";
import { syncOrderFromFf, markShippedOnTracking, refundOrderCost, rebalanceOrderCost } from "@/lib/order-status";
import { autoPushEtsyTracking } from "@/lib/etsy-tracking";
import { autoPushTiktokTracking } from "@/lib/tiktok-tracking";
import { getOnosOrder, mapOnosStatus, isPaidWord } from "@/lib/onos";
import { getCompassupTracking, getCompassupFees, type CompassupCred } from "@/lib/compassup";
import { getWembroideryOrder, mapWemStatus } from "@/lib/wembroidery";
import { getMerchizeTrackingSmart, extractMerchizeTracking } from "@/lib/merchize";
import { getVinawayOrder, extractVinawayOrder } from "@/lib/vinaway";
import { getLenfulOrder, extractLenfulOrder } from "@/lib/lenful";
import { getFlashshipOrdersByCodes, mapFsStatus } from "@/lib/flashship";
import { toISO2 } from "@/lib/printify";
import { FF_POLL_THROTTLE_MS } from "@/lib/fulfillers";

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

type OpenFfo = { id: string; orderId: string; externalFfId: string | null; status: string; trackingNumber: string | null; cost: string | null; costEvents: unknown; extNumber: string | null; country: string | null };

async function openFfosOf(fulfillerId: string): Promise<OpenFfo[]> {
  // Kèm external_number của đơn (orderLabel > externalId) để fallback hỏi Merchize khi
  // external_ff_id lưu nhầm Mongo _id thay vì code RM-xxxxx.
  const rows = await db.select({
    id: schema.fulfillmentOrders.id, orderId: schema.fulfillmentOrders.orderId,
    externalFfId: schema.fulfillmentOrders.externalFfId, status: schema.fulfillmentOrders.status,
    trackingNumber: schema.fulfillmentOrders.trackingNumber,
    cost: schema.fulfillmentOrders.cost, costEvents: schema.fulfillmentOrders.costEvents,
    label: schema.orders.orderLabel, ext: schema.orders.externalId, country: schema.orders.country,
  }).from(schema.fulfillmentOrders)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.fulfillmentOrders.orderId))
    .where(and(
    eq(schema.fulfillmentOrders.fulfillerId, fulfillerId),
    isNotNull(schema.fulfillmentOrders.externalFfId),
    notInArray(schema.fulfillmentOrders.status, ["delivered", "cancelled", "error"]),
  ));
  return rows.map(({ label, ext, ...r }) => ({ ...r, extNumber: (label?.trim() || ext || null) }));
}

async function applyUpdate(ffo: OpenFfo, upd: {
  status: string; trackingNumber?: string; trackingUrl?: string; carrier?: string;
  // Giá THẬT từ nhà in (tùy nhà mới có). base/ship/tax/fees để hiển thị; total để ghi bút toán.
  // fees = các khoản phụ có tên (design/extra…) — hiện tách riêng trên card đơn.
  cost?: { base?: number; ship?: number; tax?: number; fees?: Record<string, number>; total: number };
}): Promise<boolean> {
  const c = upd.cost;
  const total = c && c.total > 0 ? Math.round(c.total * 100) / 100 : 0;
  const prevCe = (ffo.costEvents ?? {}) as { base?: number; ship?: number; tax?: number; fees?: Record<string, number> };
  const fees = { ...(prevCe.fees ?? {}), ...(c?.fees ?? {}) };
  const feeSum = Math.round(Object.values(fees).reduce((s, v) => s + Number(v || 0), 0) * 100) / 100;
  const ship = c?.ship ?? 0, tax = c?.tax ?? 0;
  // Nhà in không trả base riêng (vd Wembroidery chỉ trả total) → DẪN XUẤT base = total − ship − tax − fees.
  // BUG CŨ: để base = TOTAL trong khi vẫn hiện Ship riêng → card ghi Base $22.10 · Ship $8.75 · Total $22.10.
  const base = c?.base ?? Math.max(0, Math.round((total - ship - tax - feeSum) * 100) / 100);
  const costChanged = !!(c && total > 0 && Math.abs(total - Number(ffo.cost ?? 0)) >= 0.005);
  // Tự chữa đơn cũ: TỔNG đúng nhưng chi tiết sai/thiếu (base=total, thiếu design/tax) → vẫn ghi lại chi tiết.
  const detailChanged = !!(c && total > 0 && (prevCe.base == null || Math.abs(base - Number(prevCe.base)) >= 0.005));
  const changed = upd.status !== ffo.status || (upd.trackingNumber && upd.trackingNumber !== ffo.trackingNumber) || costChanged || detailChanged;
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

  // GIÁ THẬT: nhà in trả cost (vd FlashShip total_fee) → ghi vào ffo + upsert bút toán qua rebalance.
  // Nhà in trả 1 số gộp thì toàn bộ nằm ở baseCost (ship/tax/fees = 0) — Total vẫn đúng.
  if (c && total > 0 && upd.status !== "cancelled" && (costChanged || detailChanged)) {
    await db.update(schema.fulfillmentOrders).set({
      baseCost: base.toFixed(2), shipCost: ship.toFixed(2),
      extraFee: (Math.round((tax + feeSum) * 100) / 100).toFixed(2), cost: total.toFixed(2),
      // Chi tiết từng khoản để card đơn tách riêng: base + ship + tax + fees(design/extra…)
      costEvents: { ...prevCe, base, ship, tax, fees },
    }).where(eq(schema.fulfillmentOrders.id, ffo.id));
    await rebalanceOrderCost(ffo.orderId, `cost sync (poll)`);
  }

  await syncOrderFromFf(ffo.orderId, upd.status);
  if (upd.trackingNumber && upd.trackingNumber !== ffo.trackingNumber) {
    await autoPushEtsyTracking(ffo.orderId);
    await autoPushTiktokTracking(ffo.orderId);
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
  if (!force && Date.now() - last < FF_POLL_THROTTLE_MS) return true;
  await db.update(schema.fulfillers).set({ credentials: { ...cred, pollSyncAt: new Date().toISOString() } }).where(eq(schema.fulfillers.id, ff.id));
  return false;
}

// Map trạng thái Merchize (poll tracking endpoint) → ffo
// QUY TẮC: chỉ "shipped" khi CÓ TRACKING; trả tiền xong = "in_production".
function mapMerchizeStatus(raw: string, hasTracking: boolean, paid = false): string {
  const s = (raw || "").toLowerCase();
  if (/cancel|refund/.test(s)) return "cancelled";
  if (/deliver|complete/.test(s)) return "delivered";
  if (hasTracking || /shipped|in.?transit|transit|picked|out.?for.?delivery/.test(s)) return "shipped";
  // "fulfilled/fulfilling" của Merchize = đang sản xuất, KHÔNG phải đã gửi hàng
  if (/produc|process|print|packing|packed|fulfil/.test(s) || isPaidWord(s) || paid) return "in_production";
  return "";
}

// Map trạng thái CHUNG cho Lenful/Vinaway (API không có doc trạng thái chi tiết).
// QUY TẮC như mọi nhà: chỉ "shipped" khi CÓ TRACKING hoặc chữ ship/transit rõ ràng.
function mapGenericStatus(raw: string, hasTracking: boolean): string {
  const s = (raw || "").toLowerCase();
  if (/cancel|refund|reject/.test(s)) return "cancelled";
  if (/deliver/.test(s)) return "delivered";
  if (hasTracking || /ship|transit|picked|out.?for.?delivery/.test(s)) return "shipped";
  if (/produc|process|print|packing|packed|fulfil|progress|approved|paid/.test(s)) return "in_production";
  return "";
}

// Dò field CHI PHÍ (best-effort) từ response ONOS/Wembroidery — chỉ ghi khi > 0.
// Số gộp → để cả vào base; nếu có tách ship/tax thì tách. Doc 2 nhà này chưa rõ tên field
// nên dò rộng; sai thì đơn giữ nguyên cost cũ (không phá gì).
function pickNum(o: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && v !== "") { const n = Number(v); if (!isNaN(n) && n > 0) return n; } }
  return 0;
}
function onosCost(d: Record<string, unknown>): { base?: number; ship?: number; tax?: number; total: number } | undefined {
  const base = pickNum(d, ["base_cost", "product_cost", "base_price", "product_price"]);
  const ship = pickNum(d, ["shipping_cost", "ship_cost", "shipping_fee"]);
  const tax = pickNum(d, ["tax", "tax_fee", "import_tax"]);
  const total = pickNum(d, ["total_cost", "total_fee", "total", "total_price", "amount"]) || (base + ship + tax);
  return total > 0 ? { base: base || undefined, ship: ship || undefined, tax: tax || undefined, total } : undefined;
}
function wemCost(o: Record<string, unknown>): { base?: number; ship?: number; tax?: number; fees?: Record<string, number>; total: number } | undefined {
  // Hoá đơn Wembroidery gồm: Sub Total (base) + Extra Cost + Design cost + Shipping Fee + Tax = Total.
  // Dò nhiều tên field vì API đặt tên không thống nhất; field nào không có thì applyUpdate tự dẫn xuất.
  const base = pickNum(o, ["baseCost", "productCost", "itemCost", "subTotal", "subtotal", "sub_total"]);
  const design = pickNum(o, ["designCost", "design_cost", "designFee", "design_fee"]);
  const extra = pickNum(o, ["extraCost", "extra_cost", "extraFee", "extra_fee"]);
  const ship = pickNum(o, ["shippingCost", "shipCost", "shippingFee", "shipping_fee"]);
  const tax = pickNum(o, ["tax", "taxAmount", "tax_amount", "taxFee", "tax_fee"]);
  const total = pickNum(o, ["totalCost", "total", "totalPrice", "grandTotal"]) || (base + design + extra + ship + tax);
  const fees: Record<string, number> = {};
  if (design > 0) fees.design = design;
  if (extra > 0) fees.extra = extra;
  return total > 0 ? { base: base || undefined, ship: ship || undefined, tax: tax || undefined, fees: Object.keys(fees).length ? fees : undefined, total } : undefined;
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
      : name.includes("flashship") ? "flashship"
      : name.includes("compassup") ? "compassup"
      : name.includes("lenful") ? "lenful"
      : name.includes("vinaway") ? "vinaway" : null;
    if (!kind) continue;
    const cred = (ff.credentials ?? {}) as Record<string, string>;
    // Lenful/Vinaway đăng nhập bằng identifier + password (password có thể nằm ở apiKey)
    const apiKey = cred.apiKey || cred.accessToken || cred.apiToken || cred.bearerToken || cred.password;
    if (!apiKey) { skipped++; continue; }
    if (await throttled(ff, !!opts.force)) { skipped++; continue; }

    const open = (await openFfosOf(ff.id)).filter((f) => !f.externalFfId?.startsWith("SIM-") && !f.externalFfId?.startsWith("MANUAL-"));
    const api = { apiKey, endpoint: ff.apiEndpoint };

    if (kind === "compassup") {
      // Compassup: 1 đơn = 1 tracking. Tracking batch 20 id/lần; cost cộng dồn fees[].
      const cCred: CompassupCred = {
        bearerToken: cred.bearerToken || apiKey, tenant: cred.tenant, restKey: cred.restKey,
        endpoint: ff.apiEndpoint, username: cred.username,
      };
      if (!cCred.tenant || !cCred.restKey) { skipped++; continue; }

      // 1) TRACKING theo lô 20
      for (let i = 0; i < open.length; i += 20) {
        if (Date.now() - started > BUDGET_MS) break;
        const batch = open.slice(i, i + 20);
        try {
          const { tracks } = await getCompassupTracking(cCred, batch.map((f) => f.externalFfId!));
          checked += batch.length;
          for (const tk of tracks) {
            // API tracks có thể không kèm order_id → nếu chỉ 1 đơn trong lô thì gán thẳng
            const ffo = tk.orderId ? batch.find((f) => f.externalFfId === tk.orderId) : (batch.length === 1 ? batch[0] : undefined);
            if (!ffo || !tk.code) continue;
            if (await applyUpdate(ffo, { status: "shipped", trackingNumber: tk.code, carrier: tk.carrier || undefined })) updated++;
          }
        } catch (e) { if (errors.length < 5) errors.push(`${ff.name} track: ${String((e as Error)?.message ?? e).slice(0, 120)}`); }
      }

      // 2) COST — poll CẢ đơn ĐÃ CÓ cost, không chỉ đơn $0.
      // BUG CŨ: chỉ hỏi đơn cost=0 → đơn push xong Compassup THÊM DỊCH VỤ (giá chốt cao hơn giá lúc push)
      // thì FUSION giữ mãi giá cũ → sổ thiếu chi phí. Ưu tiên đơn $0 trước, còn lại xoay vòng ngẫu nhiên để phủ dần.
      const costQueue = [
        ...open.filter((f) => Number(f.cost ?? 0) <= 0),
        ...open.filter((f) => Number(f.cost ?? 0) > 0).sort(() => Math.random() - 0.5),
      ].slice(0, 25);
      for (const ffo of costQueue) {
        if (Date.now() - started > BUDGET_MS) break;
        try {
          const { total } = await getCompassupFees(cCred, ffo.externalFfId!);
          if (total > 0 && Math.abs(total - Number(ffo.cost ?? 0)) >= 0.005) {
            await db.update(schema.fulfillmentOrders).set({ baseCost: total.toFixed(2), shipCost: "0", extraFee: "0", cost: total.toFixed(2) })
              .where(eq(schema.fulfillmentOrders.id, ffo.id));
            await rebalanceOrderCost(ffo.orderId, `Compassup · ${ffo.externalFfId} — cost poll`);
            updated++;
          }
        } catch (e) { if (errors.length < 5) errors.push(`${ff.name} fees: ${String((e as Error)?.message ?? e).slice(0, 120)}`); }
      }
      continue;
    }

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
            const st = mapFsStatus(d.status, d.tracking_status, hasTrack, d.payment ?? d.payment_status) || ffo.status;
            // FlashShip: total_fee là số GỘP (không tách base/ship) → để cả vào base. Chỉ ghi khi > 0.
            const fee = Number(d.total_fee ?? 0);
            if (await applyUpdate(ffo, {
              status: st, trackingNumber: d.tracking_number || undefined, carrier: d.carrier || undefined,
              cost: fee > 0 ? { total: fee } : undefined,
            })) updated++;
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
            const oc = onosCost(d);
            if (await applyUpdate(ffo, { status, trackingNumber: trackingNumber || undefined, carrier: carrier || undefined, cost: oc })) updated++;
          } else if (kind === "wem") {
            const raw = await getWembroideryOrder(api, ffo.externalFfId!);
            const root = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
            const order = (root.order && typeof root.order === "object" ? root.order : root) as Record<string, unknown>;
            const pkgs = arrOf(root.orderPackages ?? (order as Record<string, unknown>).orderPackages);
            const withTrack = pkgs.find((p) => S(p.trackingNumber));
            const trackingNumber = S(withTrack?.trackingNumber);
            const carrier = S(withTrack?.carrierCode ?? withTrack?.carrier);
            const status = mapWemStatus(S(order.status), !!(trackingNumber || ffo.trackingNumber));
            const wc = wemCost(order);
            if (await applyUpdate(ffo, { status, trackingNumber: trackingNumber || undefined, carrier: carrier || undefined, cost: wc })) updated++;
          } else if (kind === "vinaway") {
            // Vinaway: GET /api/orders/{internal_order_id} → Pricing Details tách sẵn từng khoản
            const raw = await getVinawayOrder({ endpoint: ff.apiEndpoint, email: cred.email || cred.identifier || cred.userName || "", password: cred.password || apiKey }, ffo.externalFfId!);
            const v = extractVinawayOrder(raw);
            const status = mapGenericStatus(v.status ?? "", !!(v.trackingNumber || ffo.trackingNumber)) || ffo.status;
            const vFees: Record<string, number> = {};
            if ((v.designFee ?? 0) > 0) vFees.design = v.designFee!;
            if ((v.surcharge ?? 0) > 0) vFees.surcharge = v.surcharge!;
            if ((v.discount ?? 0) > 0) vFees.discount = -v.discount!; // giảm giá = số ÂM trong fees
            if (await applyUpdate(ffo, {
              status, trackingNumber: v.trackingNumber, carrier: v.carrier,
              cost: (v.total ?? 0) > 0 ? { base: v.base, ship: v.ship, tax: v.tax, fees: Object.keys(vFees).length ? vFees : undefined, total: v.total! } : undefined,
            })) updated++;
          } else if (kind === "lenful") {
            // Lenful: API không public endpoint detail → getLenfulOrder tự dò path; không thấy thì bỏ qua êm
            const lCred = {
              endpoint: ff.apiEndpoint, userName: cred.userName || cred.user_name || cred.identifier || "",
              password: cred.password || cred.apiKey || "", storeId: cred.storeId || cred.store_id || cred.shopId || "",
            };
            if (!lCred.userName || !lCred.password) { skipped++; return; }
            const d = await getLenfulOrder(lCred, ffo.externalFfId!);
            if (!d) { skipped++; return; }
            const L = extractLenfulOrder(d);
            const status = mapGenericStatus(L.status ?? "", !!(L.trackingNumber || ffo.trackingNumber)) || ffo.status;
            if (await applyUpdate(ffo, {
              status, trackingNumber: L.trackingNumber, carrier: L.carrier,
              cost: (L.total ?? 0) > 0 ? { base: L.base, ship: L.ship, tax: L.tax, total: L.total! } : undefined,
            })) updated++;
          } else {
            // Merchize: endpoint tracking trả kèm status (cancel/fulfilled/...) và ĐÔI KHI cả chi phí.
            // Đơn cũ lưu nhầm Mongo _id → fallback hỏi bằng external_number + identifier.
            const baseUrl = ff.apiEndpoint?.trim() || "https://bo-group-2.merchize.com/hgu3s";
            const { raw } = await getMerchizeTrackingSmart(baseUrl, apiKey, {
              code: ffo.externalFfId ?? undefined,
              externalNumber: ffo.extNumber ?? undefined,
              identifier: cred.identifier,
            });
            // Import tax phụ thuộc NƯỚC GIAO HÀNG (captured_catalogs[SKU].tax[US] …)
            const t = extractMerchizeTracking(raw, toISO2(ffo.country));
            // Merchize trả về chi phí = đơn ĐÃ ĐƯỢC TRẢ TIỀN → vào sản xuất
            const mzPaid = (t.fulfillmentCost ?? 0) > 0;
            const status = mapMerchizeStatus(t.status ?? "", !!(t.trackingNumber || ffo.trackingNumber), mzPaid) || ffo.status;
            if (await applyUpdate(ffo, { status, trackingNumber: t.trackingNumber, trackingUrl: t.trackingUrl, carrier: t.carrier })) updated++;

            // CHI PHÍ: Merchize chỉ bắn tiền qua webhook PAYMENT — webhook không tới thì đơn kẹt ở
            // giá SKU mapping (thiếu import tax). Poll trả về giá thì MERGE + cân lại sổ.
            // BUG CŨ: poll GHI ĐÈ extraFee = import tax → XOÁ MẤT surcharge nhận qua webhook; còn
            // webhook lại không biết import tax → hai bên giẫm nhau, Tax/fee nhảy số loạn xạ.
            // Giờ: import tax lưu vào costEvents.tax, GIỮ nguyên fees (surcharge) của webhook,
            // extra = tax + Σfees (gộp entry CÙNG SỐ TIỀN — tự chữa dữ liệu cũ bị cộng trùng theo event_id).
            const base = t.fulfillmentCost, ship = t.shippingCost ?? 0, tax = t.importTax ?? 0;
            if (base != null && status !== "cancelled") {
              const prevCe = (ffo.costEvents ?? {}) as { base?: number; ship?: number; tax?: number; fees?: Record<string, number> };
              const seenAmt = new Set<string>(); let feeSum = 0;
              for (const v of Object.values(prevCe.fees ?? {})) { const k = Number(v || 0).toFixed(2); if (seenAmt.has(k)) continue; seenAmt.add(k); feeSum += Number(v || 0); }
              const extra = Math.round((tax + feeSum) * 100) / 100;
              const total = Math.round((base + ship + extra) * 100) / 100;
              if (total > 0 && Math.abs(total - Number(ffo.cost ?? 0)) >= 0.005) {
                await db.update(schema.fulfillmentOrders).set({
                  baseCost: base.toFixed(2), shipCost: ship.toFixed(2), extraFee: extra.toFixed(2), cost: total.toFixed(2),
                  costEvents: { ...prevCe, base, ship, tax },
                }).where(eq(schema.fulfillmentOrders.id, ffo.id));
                await db.update(schema.transactions).set({ amount: (-total).toFixed(2) }).where(and(
                  eq(schema.transactions.orderId, ffo.orderId),
                  eq(schema.transactions.type, "base_cost"),
                  like(schema.transactions.note, `%${ffo.externalFfId}%`),
                ));
                await rebalanceOrderCost(ffo.orderId, `Merchize · ${ffo.externalFfId} — cost poll`);
                updated++;
              }
            }
          }
        } catch (e) {
          if (errors.length < 5) errors.push(`${ff.name} ${ffo.externalFfId}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
        }
      }));
    }
  }
  return { ok: true, checked, updated, skipped, errors: errors.length ? errors : undefined };
}
