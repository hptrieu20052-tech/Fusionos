// ===== Wembroidery Fulfillment API (gateway.wembroidery.com/api) =====
// Docs: https://gateway.wembroidery.com/api/docs (PDF 07/2026).
// - Auth: token QUERY PARAM (?token=...) — lấy từ seller.wembroidery.com → Store → API store → token.
//   Dán token vào ô API Key ở Settings.
// - Endpoints chính:
//   GET  /public/catalog                → catalog (catalogId + sizes + colors + giá)
//   POST /orders                        → tạo đơn (normal / tiktokshop / tiktok label)
//   GET  /orders/{orderId}              → chi tiết (tracking nằm ở orderPackages)
//   POST /orders/seller-cancel          → huỷ đơn
//   POST /orders/confirm_address        → xác nhận địa chỉ
//   POST /webhook/endpoints             → đăng ký webhook (update_tracking | update_order_status)
// - Webhook ký HMAC-SHA256 bằng webhook secret; so sánh chống timing attack.

import crypto from "crypto";

const WEM_API = "https://gateway.wembroidery.com/api";

type Cred = { apiKey: string; endpoint?: string | null };
// Timeout tạo MỚI mỗi call — KHÔNG đặt AbortSignal.timeout() ở module level (warm Lambda abort ngầm).
const ft = () => ({ signal: AbortSignal.timeout(25000) });
const base = (c: Cred) => (c.endpoint && c.endpoint.trim() ? c.endpoint.trim().replace(/\/+$/, "") : WEM_API);
const withToken = (c: Cred, path: string) => `${base(c)}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(c.apiKey.trim())}`;

async function call<T = Record<string, unknown>>(c: Cred, path: string, init?: RequestInit): Promise<{ status: number; json: T }> {
  const r = await fetch(withToken(c, path), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined) },
    ...ft(),
  });
  const json = (await r.json().catch(() => ({}))) as T;
  return { status: r.status, json };
}
const errText = (j: unknown) => {
  const o = (j ?? {}) as Record<string, unknown>;
  return String(o.message ?? o.error ?? o.msg ?? JSON.stringify(o)).slice(0, 300);
};
const S = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const N = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const arrOf = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

// ---- Catalog: GET /public/catalog — dò phòng thủ nhiều shape ----
export type WemCatalogRow = { catalogId: string; product: string; size: string; color: string; cost: number };
export async function getWembroideryCatalog(c: Cred): Promise<{ rows: WemCatalogRow[]; sample: unknown }> {
  const { status, json } = await call<Record<string, unknown>>(c, "/public/catalog");
  if (status === 401) throw new Error("Wembroidery 401: token invalid — paste the store token into API Key");
  if (status >= 400) throw new Error(`Wembroidery catalog failed: ${status} ${errText(json)}`);
  const root = (json.data && typeof json.data === "object" && !Array.isArray(json.data) ? (json.data as Record<string, unknown>) : json);
  const catalogs = [json.data, root.catalogs, root.items, root.data, root.list, json].map(arrOf).find((a) => a.length) ?? [];

  const rows: WemCatalogRow[] = [];
  for (const p of catalogs) {
    const id = S(p.id ?? p.catalogId ?? p.catalog_id ?? p._id);
    if (!id) continue;
    const name = S(p.name ?? p.title ?? p.productName) || `Catalog ${id}`;
    const baseCost = N(p.baseCost ?? p.base_cost ?? p.price ?? p.cost);
    // sizes/colors: mảng string HOẶC mảng object {value|code|name, price?}
    const optList = (v: unknown): { value: string; price?: number }[] =>
      arrOf(v).length
        ? arrOf(v).map((o) => ({ value: S(o.value ?? o.code ?? o.name ?? o.text ?? o), price: Number(o.price ?? o.cost) || undefined })).filter((o) => o.value)
        : (Array.isArray(v) ? (v as unknown[]).map((s) => ({ value: S(s) })).filter((o) => o.value) : []);
    const sizes = optList(p.sizes ?? p.size ?? (p.config as Record<string, unknown> | undefined)?.sizes);
    const colors = optList(p.colors ?? p.color ?? (p.config as Record<string, unknown> | undefined)?.colors);
    // Variants sẵn (nếu API trả) ưu tiên hơn tổ hợp size×color
    const variants = arrOf(p.variants);
    if (variants.length) {
      for (const v of variants) {
        rows.push({ catalogId: id, product: name, size: S(v.size), color: S(v.color), cost: N(v.price ?? v.cost) || baseCost });
      }
    } else if (sizes.length || colors.length) {
      for (const sz of (sizes.length ? sizes : [{ value: "" }])) {
        for (const cl of (colors.length ? colors : [{ value: "" }])) {
          rows.push({ catalogId: id, product: name, size: sz.value, color: cl.value, cost: sz.price ?? cl.price ?? baseCost });
        }
      }
    } else {
      rows.push({ catalogId: id, product: name, size: "", color: "", cost: baseCost });
    }
  }
  return { rows, sample: catalogs[0] ?? json };
}

// ---- Create order: POST /orders ----
export type WemDesign = {
  location: string;               // "front" | "back" | ... (theo catalog)
  imageUrl?: string;              // ảnh design (PNG/JPG)
  embUrl?: string;                // file thêu (.emb/.dst/.pes...) nếu có
  mockup?: string;
  note?: string;
  // Đính kèm (applique): cần thêm outline ("Satin"|"Square") + fabric (mã vải theo docs)
  applique?: boolean;
  outline?: "Satin" | "Square";
  fabric?: (string | number)[];
};
export type WemItem = {
  catalogId: number;
  designs: WemDesign[];
  quantity: number;
  size: string;                   // snake/lower theo catalog: s, m, l, xl...
  color: string;                  // snake_case: black, sport_grey...
  areaColor?: Record<string, string>; // color-block: { a: "black", b: "white"... }
};
export type WemCreateOrder = {
  address?: {
    firstName: string; lastName: string; address1: string; address2?: string;
    city: string; state: string; zip: string; country: string; email?: string; phone?: string;
  };
  sellerOrderId: string;
  shippingMethod: string;         // "standard" | ...
  items: WemItem[];
  referralCode?: string;
  isSample?: boolean;
  ioss?: string;
  isTiktokShop?: boolean;         // đơn TikTok Shop
  isTiktokLabel?: boolean;        // đơn TikTok có sẵn label
  trackingNumber?: string;        // kèm isTiktokLabel
  shippingLabel?: string;         // link label kèm isTiktokLabel
};
export async function createWembroideryOrder(c: Cred, order: WemCreateOrder): Promise<{ wemId: string; raw: unknown; dedup: boolean; baseCost?: number; shipCost?: number }> {
  const { status, json } = await call<Record<string, unknown>>(c, "/orders", { method: "POST", body: JSON.stringify(order) });
  const data = (json.data && typeof json.data === "object" ? (json.data as Record<string, unknown>) : json);
  const ord = (data.order && typeof data.order === "object" ? (data.order as Record<string, unknown>) : data);
  const wemId = S(ord.id ?? ord.orderId ?? ord._id ?? data.id ?? data.orderId);
  if (status >= 400) {
    const msg = errText(json);
    // CHỐNG TRÙNG kiểu Printway: đơn đã tồn tại (từ lần push timeout trước) → link đơn cũ
    if (/exist|duplicat/i.test(msg)) return { wemId: wemId || order.sellerOrderId, raw: json, dedup: true };
    if (status === 401) throw new Error("Wembroidery 401: token invalid — paste the store token into API Key");
    throw new Error(`Wembroidery create order failed: ${status} ${msg}`);
  }
  // Giá nếu response trả kèm (subTotal = base, shippingCost = ship)
  const baseCost = Number(ord.subTotal) || undefined;
  const shipCost = Number(ord.shippingCost) || undefined;
  return { wemId: wemId || order.sellerOrderId, raw: json, dedup: false, baseCost, shipCost };
}

// ---- Order detail: tracking nằm ở orderPackages ----
export async function getWembroideryOrder(c: Cred, wemId: string): Promise<Record<string, unknown>> {
  const { status, json } = await call<Record<string, unknown>>(c, `/orders/${encodeURIComponent(wemId)}`);
  if (status >= 400) throw new Error(`Wembroidery get order failed: ${status} ${errText(json)}`);
  return json;
}

// ---- Cancel: POST /orders/seller-cancel ----
export async function cancelWembroideryOrder(c: Cred, wemId: string, reason?: string): Promise<unknown> {
  const { status, json } = await call(c, "/orders/seller-cancel", { method: "POST", body: JSON.stringify({ orderId: wemId, cancelReason: reason || "cancel" }) });
  if (status >= 400) throw new Error(`Wembroidery cancel failed: ${status} ${errText(json)}`);
  return json;
}

// ---- Webhook: verify chữ ký HMAC-SHA256 ----
// Docs: signature header + timestamp header; stringToSign = timestamp + payload; so sánh timingSafeEqual.
// Dò phòng thủ: thử cả `${ts}.${body}`, `${ts}${body}`, và body trần; chấp nhận hex có/không prefix "sha256=".
export function verifyWembroiderySignature(rawBody: string, secret: string, signature: string | null, timestamp: string | null): boolean {
  if (!signature || !secret) return false;
  const received = signature.replace(/^sha256=/i, "").trim();
  const candidates = timestamp ? [`${timestamp}.${rawBody}`, `${timestamp}${rawBody}`, rawBody] : [rawBody];
  for (const s of candidates) {
    const expected = crypto.createHmac("sha256", secret).update(s).digest("hex");
    try {
      if (received.length === expected.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) return true;
    } catch { /* length mismatch */ }
  }
  return false;
}

// ---- Map trạng thái Wembroidery → trạng thái fulfillment nội bộ ----
// Statuses: pending_payment, paid, processing, shipped, completed, archived, refunded, cancelled
export function mapWemStatus(raw: string, hasTracking: boolean): string {
  const s = raw.toLowerCase();
  if (/cancel|refund/.test(s)) return "cancelled";
  if (/complete|archiv|deliver/.test(s)) return "delivered";
  if (/ship/.test(s) || hasTracking) return "shipped";
  if (/process/.test(s)) return "in_production";
  return "pushed";
}
