// ===== ONOS POD Public API (api-app.onospod.com/api/v1) =====
// Docs: Postman "ONOS PUBLIC API" (PDF 07/2026).
// - Auth: "Authorization: Bearer <token>".
//   + Token lấy trực tiếp từ ONOS, dán vào ô API Key ở Settings; HOẶC
//   + Dán "email:password" vào ô API Key → FUSION tự POST /login lấy token (cache 30').
// - Dedupe phía ONOS: 1 order là duy nhất khi trùng cả "order_id" + "identifier".
// - Endpoints chính:
//   POST /login {email,password} → token
//   GET  /products?page=&page_size=       (list, có print_areas)
//   POST /order/create                    (tạo đơn thật)   | /order/create/test (sandbox)
//   GET  /order/{onos_id}                 (chi tiết)
//   GET  /order/{onos_id}/shipment/events (tracking events)
//   POST /order/tracking-list {tracking:[..]}
//   GET/POST/DELETE /webhooks/            (topic: 'order.updated' | 'shipment.events', secret sha256)

const ONOS_API = "https://api-app.onospod.com/api/v1";

type Cred = { apiKey: string; endpoint?: string | null };
// Timeout tạo MỚI mỗi call — KHÔNG BAO GIỜ đặt AbortSignal.timeout() ở module level (warm Lambda sẽ abort ngầm).
const ft = () => ({ signal: AbortSignal.timeout(25000) });
const base = (c: Cred) => (c.endpoint && c.endpoint.trim() ? c.endpoint.trim().replace(/\/+$/, "") : ONOS_API);

// ---- Token: apiKey là token sẵn, hoặc "email:password" → login (cache theo apiKey, TTL 30') ----
const tokenCache = new Map<string, { token: string; exp: number }>();
async function bearer(c: Cred): Promise<string> {
  const key = c.apiKey.trim();
  // "email:password" (có @ trước dấu :) → login lấy token
  const m = /^([^\s:]+@[^\s:]+):(.+)$/.exec(key);
  if (!m) return key; // token dán thẳng
  const hit = tokenCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.token;
  const r = await fetch(`${base(c)}/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: m[1], password: m[2] }), ...ft(),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const data = (j.data && typeof j.data === "object" ? j.data : j) as Record<string, unknown>;
  const token = [data.token, data.access_token, data.accessToken, j.token]
    .find((v): v is string => typeof v === "string" && v.length > 10);
  if (!r.ok || !token) throw new Error(`ONOS login failed: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  tokenCache.set(key, { token, exp: Date.now() + 30 * 60_000 });
  return token;
}
async function hdr(c: Cred): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await bearer(c)}`, "Content-Type": "application/json" };
}

// ---- Fetch chung: đọc lỗi thân thiện ----
async function call<T = Record<string, unknown>>(c: Cred, path: string, init?: RequestInit): Promise<{ status: number; json: T }> {
  const r = await fetch(`${base(c)}${path}`, { ...init, headers: { ...(await hdr(c)), ...(init?.headers as Record<string, string> | undefined) }, ...ft() });
  const json = (await r.json().catch(() => ({}))) as T;
  return { status: r.status, json };
}
const errText = (j: unknown) => {
  const o = (j ?? {}) as Record<string, unknown>;
  return String(o.message ?? o.error ?? o.msg ?? JSON.stringify(o)).slice(0, 300);
};

// ---- Products: GET /products (dò phòng thủ nhiều shape data/items/products + variants) ----
export type OnosVariant = { sku: string; product: string; variant: string; productId: string; price?: number; printAreas?: string[] };
export async function listOnosProducts(c: Cred, page = 1, pageSize = 100): Promise<{ variants: OnosVariant[]; hasMore: boolean; sample: unknown }> {
  const { status, json } = await call<Record<string, unknown>>(c, `/products?page=${page}&page_size=${pageSize}`);
  if (status === 401) throw new Error("ONOS 401: token invalid/expired — paste a new token (or email:password) into API Key");
  if (status >= 400) throw new Error(`ONOS products failed: ${status} ${errText(json)}`);
  const S = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  const arrOf = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const root = (json.data && typeof json.data === "object" && !Array.isArray(json.data) ? (json.data as Record<string, unknown>) : json);
  const products = [json.data, root.items, root.products, root.data, root.list, json].map(arrOf).find((a) => a.length) ?? [];

  const out: OnosVariant[] = [];
  for (const p of products) {
    const pName = S(p.name ?? p.title ?? p.product_name);
    const pId = S(p.id ?? p._id ?? p.product_id ?? p.code);
    const printAreas = arrOf(p.print_areas).map((a) => S((a as Record<string, unknown>).key ?? a)).filter(Boolean);
    const variants = arrOf(p.variants ?? p.skus ?? p.items);
    if (variants.length) {
      for (const v of variants) {
        const sku = S(v.sku ?? v.code ?? v.variant_sku ?? v.id);
        if (!sku) continue;
        const color = S(v.color ?? (v.attributes as Record<string, unknown> | undefined)?.color);
        const size = S(v.size ?? (v.attributes as Record<string, unknown> | undefined)?.size);
        out.push({
          sku, product: pName || sku, productId: pId || sku,
          variant: [color, size].filter(Boolean).join(" / "),
          price: Number(v.price ?? v.base_cost ?? v.cost) || undefined,
          printAreas: printAreas.length ? printAreas : undefined,
        });
      }
    } else {
      const sku = S(p.sku ?? p.code ?? pId);
      if (!sku) continue;
      out.push({ sku, product: pName || sku, productId: pId || sku, variant: "", price: Number(p.price ?? p.base_cost) || undefined, printAreas: printAreas.length ? printAreas : undefined });
    }
  }
  return { variants: out, hasMore: products.length >= pageSize, sample: products[0] ?? json };
}

// ---- Create order: POST /order/create ----
export type OnosItem = {
  sku: string; quantity: number;
  name?: string; product_id?: string; price?: number; currency?: string;
  image?: string; // mockup
  attributes?: { name: string; option: string }[]; // tối thiểu Color + Size
  design_front?: string; design_back?: string; design_hood?: string;
  design_chest_left?: string; design_chest_right?: string;
  // print_areas CHỈ hoạt động khi body KHÔNG chứa các key design_*; keys lấy từ /products
  print_areas?: { key: string; value: string }[];
};
export type OnosCreateOrder = {
  order_id: string;              // Required — id phía FUSION
  identifier?: string;           // nguồn đơn; (order_id + identifier) = unique
  order_name?: string;
  reference_id?: string;
  customer_note?: string;
  note?: string;
  items: OnosItem[];
  shipping_info: {
    full_name: string; address_1: string; address_2?: string;
    city: string; state: string; postcode: string; country: string; // ISO2
    email?: string; phone?: string;
  };
  // ONOSEXPRESS: line ship của onos | SBTT: ship by tiktok | COD: trả về merchant sau sản xuất
  shipping_method?: "ONOSEXPRESS" | "SBTT" | "COD";
  inc_active_service?: boolean;  // active tracking by USPS — chỉ với SBTT (từ 29/04/2025)
  tracking?: { tracking_number: string; carrier: string; link_print?: string };
  tracking_active_day?: number;  // 0..5, KHÔNG dùng chung với tracking
};
export async function createOnosOrder(c: Cred, order: OnosCreateOrder, test = false): Promise<{ onosId: string; raw: unknown; dedup: boolean }> {
  const { status, json } = await call<Record<string, unknown>>(c, test ? "/order/create/test" : "/order/create", {
    method: "POST", body: JSON.stringify(order),
  });
  const S = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  const data = (json.data && typeof json.data === "object" ? (json.data as Record<string, unknown>) : json);
  const onosId = S(data.id ?? data.order_id ?? data.onos_id ?? data.code ?? data.order_code);
  if (status >= 400) {
    // CHỐNG TRÙNG kiểu Printway: nếu ONOS báo đơn đã tồn tại → coi là thành công, link đơn cũ
    const msg = errText(json);
    if (/exist|duplicat|trùng/i.test(msg)) return { onosId: onosId || order.order_id, raw: json, dedup: true };
    if (status === 401) throw new Error("ONOS 401: token invalid/expired — paste a new token into API Key");
    throw new Error(`ONOS create order failed: ${status} ${msg}`);
  }
  return { onosId: onosId || order.order_id, raw: json, dedup: false };
}

// ---- Order detail + tracking ----
export async function getOnosOrder(c: Cred, onosId: string): Promise<Record<string, unknown>> {
  const { status, json } = await call<Record<string, unknown>>(c, `/order/${encodeURIComponent(onosId)}`);
  if (status >= 400) throw new Error(`ONOS get order failed: ${status} ${errText(json)}`);
  return json;
}
export async function getOnosShipmentEvents(c: Cred, onosId: string): Promise<Record<string, unknown>> {
  const { status, json } = await call<Record<string, unknown>>(c, `/order/${encodeURIComponent(onosId)}/shipment/events`);
  if (status >= 400) throw new Error(`ONOS shipment events failed: ${status} ${errText(json)}`);
  return json;
}

// ---- Cancel: DELETE /order/{onos_id} ----
export async function cancelOnosOrder(c: Cred, onosId: string): Promise<{ ok: boolean; message: string }> {
  const { status, json } = await call(c, `/order/${encodeURIComponent(onosId)}`, { method: "DELETE" });
  if (status >= 400) return { ok: false, message: `${status} ${errText(json)}` };
  return { ok: true, message: "cancelled" };
}

// ---- Webhooks: GET/POST/DELETE /webhooks/ ----
export async function listOnosWebhooks(c: Cred): Promise<unknown> {
  const { status, json } = await call(c, "/webhooks/");
  if (status >= 400) throw new Error(`ONOS list webhooks failed: ${status} ${errText(json)}`);
  return json;
}
export async function createOnosWebhook(c: Cred, topic: "order.updated" | "shipment.events", endpoint: string, secret: string): Promise<unknown> {
  const { status, json } = await call(c, "/webhooks/", { method: "POST", body: JSON.stringify({ topic, endpoint, secret }) });
  if (status >= 400 && !/exist/i.test(errText(json))) throw new Error(`ONOS create webhook (${topic}) failed: ${status} ${errText(json)}`);
  return json;
}

// ---- Map trạng thái ONOS → trạng thái fulfillment nội bộ ----
export function mapOnosStatus(raw: string, hasTracking: boolean): string {
  const s = raw.toLowerCase();
  if (/cancel|refund/.test(s)) return "cancelled";
  if (/deliver|complete/.test(s)) return "delivered";
  if (/ship|transit|picked/.test(s) || hasTracking) return "shipped";
  if (/process|produc|print/.test(s)) return "in_production";
  if (/pend|creat|paid|new/.test(s)) return "pushed";
  return hasTracking ? "shipped" : "pushed";
}
