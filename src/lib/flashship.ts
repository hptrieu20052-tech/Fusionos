// ===== FlashShip POD API v2 (seller) =====
// Docs: https://docs.flashship.net/
// - Base MẶC ĐỊNH: https://api2.flashship.net/seller-api-v2 — endpoint KHÔNG cần whitelist IP
//   (FlashShip support xác nhận 07/2026; api.flashship.net yêu cầu whitelist IP tĩnh, Vercel không có).
// - UAT: https://uat-api.flashship.net/seller-api-v2
// - Auth: "Authorization: Bearer <token>" — dùng API token sinh trên web (hạn 1 năm),
//   hoặc POST /token {username,password} → data.access_token (expires_in 18000s).
// - Response chung: { code: "FLS_200"|"FLS-406"|..., msg, data, err }
//   FLS-406 = hết balance → ĐƠN VẪN TẠO, payment PENDING, trả tiền trên web admin.

const FS_API = "https://api2.flashship.net/seller-api-v2";

type Cred = { accessToken: string; endpoint?: string | null };
// Timeout 20s, signal tạo MỚI mỗi lần gọi (module-level sẽ hết hạn 1 lần rồi abort mọi call sau).
const ft = () => ({ signal: AbortSignal.timeout(20000) });
const base = (c: Cred) => (c.endpoint && c.endpoint.trim() ? c.endpoint.trim().replace(/\/+$/, "") : FS_API);
const headers = (c: Cred) => ({ Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json" }) as Record<string, string>;

type FsEnvelope = { code?: string; msg?: string; data?: unknown; err?: unknown };
const okCode = (code?: string) => !!code && /200/.test(code);
const isBalancePending = (code?: string) => !!code && /406/.test(code);

// ---- Variants: GET /orders/list-variant-sku → data: [{variant_id, product_type, brand, style, size, color}] ----
export type FsVariant = { variant_id: number; product_type: string; brand: string; style: string; size: string; color: string };
export async function listFlashshipVariants(c: Cred): Promise<FsVariant[]> {
  const r = await fetch(`${base(c)}/orders/list-variant-sku`, { headers: headers(c), ...ft() });
  const j = (await r.json().catch(() => ({}))) as FsEnvelope;
  if (!r.ok || !okCode(j.code)) throw new Error(`FlashShip list variants failed: ${j.code ?? r.status} ${j.msg ?? ""} ${JSON.stringify(j.err ?? "").slice(0, 120)}`.trim());
  return (Array.isArray(j.data) ? j.data : []) as FsVariant[];
}

// ---- Create order: POST /orders/shirt-add | /orders/ornament-add → data = order_code ----
export type FsProduct = {
  variant_id: number;
  quantity: number;
  note?: string;
  printType?: 1 | 2; // 1 DTF, 2 DTG — cả đơn phải cùng loại
  printer_design_front_url?: string | null;
  printer_design_back_url?: string | null;
  printer_design_right_url?: string | null;
  printer_design_left_url?: string | null;
  printer_design_neck_url?: string | null;
  printer_design_pocket_url?: string | null;
  printer_design_hood_url?: string | null;
  printer_design_neck_inner_url?: string | null;
  mockup_front_url?: string | null;
  mockup_back_url?: string | null;
  mockup_right_url?: string | null;
  mockup_left_url?: string | null;
  mockup_neck_url?: string | null;
  mockup_pocket_url?: string | null;
  mockup_hood_url?: string | null;
  mockup_neck_inner_url?: string | null;
};
export type FsCreateOrder = {
  order_id: string; // partner order id — trống thì FlashShip tự sinh
  buyer_first_name: string;
  buyer_last_name?: string;
  buyer_email?: string;
  buyer_phone?: string;
  buyer_address1: string;
  buyer_address2?: string;
  buyer_city: string;
  buyer_province_code: string; // viết tắt bang US (IN, CA...)
  buyer_zip: string;
  buyer_country_code: string; // mặc định US
  shipment: number; // 1 FirstClass · 2 Priority · 3 RushProduction · 4 OverNight · 6 Expedite
  link_label?: string | null;
  products: FsProduct[];
};
export async function createFlashshipOrder(
  c: Cred, payload: FsCreateOrder, kind: "shirt" | "ornament" = "shirt",
): Promise<{ orderCode: string; paymentPending: boolean; raw: unknown }> {
  const r = await fetch(`${base(c)}/orders/${kind}-add`, { method: "POST", headers: headers(c), body: JSON.stringify(payload), ...ft() });
  const j = (await r.json().catch(() => ({}))) as FsEnvelope;
  const pending = isBalancePending(j.code);
  if (!okCode(j.code) && !pending) {
    throw new Error(`FlashShip create order failed: ${j.code ?? r.status} ${j.msg ?? ""} ${JSON.stringify(j.err ?? "").slice(0, 200)}`.trim());
  }
  const orderCode = typeof j.data === "string" ? j.data : String((j.data as Record<string, unknown>)?.order_code ?? payload.order_id);
  return { orderCode, paymentPending: pending, raw: j };
}

// ---- Cancel: POST /orders/seller-reject { order_code_list, reject_note } (status không được là COMPLETED) ----
export async function cancelFlashshipOrders(c: Cred, orderCodes: string[], note = ""): Promise<{ ok: boolean; message: string }> {
  const r = await fetch(`${base(c)}/orders/seller-reject`, {
    method: "POST", headers: headers(c),
    body: JSON.stringify({ order_code_list: orderCodes, reject_note: note }),
    ...ft(),
  });
  const j = (await r.json().catch(() => ({}))) as FsEnvelope;
  return { ok: r.ok && okCode(j.code), message: `${j.code ?? r.status} ${j.msg ?? ""}`.trim() };
}

// ---- Detail theo lô: POST /orders/list-order-code { list_order_code } (max 20/lần) ----
export type FsOrderDetail = {
  order_code: string; partner_order_id: string; status: string;
  tracking_number: string | null; tracking_status: string | null; carrier: string | null;
  total_fee: number | null; reject_note: string | null;
};
export async function getFlashshipOrdersByCodes(c: Cred, codes: string[]): Promise<FsOrderDetail[]> {
  const r = await fetch(`${base(c)}/orders/list-order-code`, {
    method: "POST", headers: headers(c),
    body: JSON.stringify({ list_order_code: codes.slice(0, 20) }),
    ...ft(),
  });
  const j = (await r.json().catch(() => ({}))) as FsEnvelope;
  if (!r.ok || (j.code && !okCode(j.code))) throw new Error(`FlashShip list-order-code failed: ${j.code ?? r.status} ${j.msg ?? ""}`.trim());
  const d = j.data ?? j;
  return (Array.isArray(d) ? d : [d].filter(Boolean)) as FsOrderDetail[];
}

// ---- Map trạng thái FlashShip → trạng thái ffo của FUSION ----
// CONFIRMED → pushed · IN_PRODUCING/COMPLETED → in_production (chưa có tracking) ·
// HOLD → error (kèm message) · CANCELED/REFUNDED → cancelled · tracking Delivered → delivered
export function mapFsStatus(status: string, trackingStatus?: string | null, hasTracking = false): string {
  const s = (status || "").toUpperCase();
  const t = (trackingStatus || "").toLowerCase();
  if (/deliver/.test(t)) return "delivered";
  if (hasTracking || /transit|pre-shipment|shipment/.test(t)) return "shipped";
  if (s === "CANCELED" || s === "REFUNDED") return "cancelled";
  if (s === "HOLD") return "error";
  if (s === "IN_PRODUCING" || s === "COMPLETED") return "in_production";
  if (s === "CONFIRMED") return "pushed";
  return "";
}
