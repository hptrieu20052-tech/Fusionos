// VINAWAY API (POD) — Bearer token từ email/password, đẩy đơn production.
// Doc CHUẨN: https://documenter.getpostman.com/view/7468749/2sAYk7SPWa (Postman, seller gửi 2026-07-20)
// Base: https://gateway.vinaway.io
//   POST /api/token            { email, password } → { access_token, expires_in: 18000 (giây) }
//   POST /api/orders           (Bearer) → { success, message, internal_order_id, amount_total }
//   GET  /api/orders/{internal_order_id}
//   GET  /api/production-lines?page&limit  (id 1 Standard · 2 Express, added_price…)
//   GET  /api/products?page&limit · GET /api/product-skus?page&limit  (id dùng khi tạo đơn)

export type VinawayCred = { endpoint?: string | null; email: string; password: string };

const tokenCache = new Map<string, { token: string; exp: number }>();
// Chuẩn hoá base: bỏ path thừa nếu user lỡ dán …/api hoặc …/api/token.
const baseOf = (endpoint?: string | null) => {
  let b = (endpoint || "https://gateway.vinaway.io").trim().replace(/\/+$/, "");
  b = b.replace(/\/api(\/[a-z0-9/_-]*)?$/i, "");
  return b || "https://gateway.vinaway.io";
};

// fetch có CHẨN ĐOÁN: "fetch failed" của Node giấu nguyên nhân trong e.cause → lôi ra code cụ thể
// (ENOTFOUND sai domain · ECONNREFUSED/ETIMEDOUT firewall chặn · CERT_* lỗi chứng chỉ TLS…).
const vFetch = async (url: string, init: RequestInit): Promise<Response> => {
  try {
    return await fetch(url, init);
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const why = err?.cause?.code || err?.cause?.message || err?.message || String(e);
    throw new Error(`Vinaway: không kết nối được ${url} — ${why}. Nếu là ETIMEDOUT/ECONNREFUSED thì server Vinaway đang chặn IP nước ngoài (Vercel ở Mỹ) — báo Vinaway mở firewall cho server của bạn.`);
  }
};

export async function vinawayToken(cred: VinawayCred): Promise<string> {
  const base = baseOf(cred.endpoint);
  const key = `${base}|${cred.email}`;
  const hit = tokenCache.get(key);
  if (hit && hit.exp - 60_000 > Date.now()) return hit.token;

  const res = await vFetch(`${base}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: cred.email, password: cred.password }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vinaway token HTTP ${res.status}: ${text.slice(0, 200)}`);
  let j: Record<string, unknown>;
  try { j = JSON.parse(text); } catch { throw new Error("Vinaway token: non-JSON response"); }
  const token = String(j?.access_token ?? "");
  if (!token) throw new Error("Vinaway token: no access_token (" + text.slice(0, 150) + ")");
  const ttl = (Number(j?.expires_in) || 18000) * 1000;
  tokenCache.set(key, { token, exp: Date.now() + ttl });
  return token;
}

export type VinawaySurface = { product_surface_id: number; design_png: string };
export type VinawayItem = {
  /** id nội bộ tuỳ ý để đối soát (doc dùng uuid) */
  localId?: string;
  product_id: number;
  product_sku_id: number;
  quantity: number;
  mockup1?: string;
  mockup2?: string;
  productSurfaces?: VinawaySurface[];
};
export type VinawayOrder = {
  /** 1 Production (theo ví dụ doc) */
  type: number;
  external_order_id?: string;
  /** GET /api/production-lines: 1 Standard · 2 Express */
  production_line_id: number;
  note_seller?: string;
  customer_name: string;
  address1?: string; address2?: string; city?: string; zip?: string; country?: string; state?: string;
  email?: string; tel?: string;
  items: VinawayItem[];
};

export async function createVinawayOrder(cred: VinawayCred, order: VinawayOrder): Promise<{ id: string; raw: unknown }> {
  const base = baseOf(cred.endpoint);
  const token = await vinawayToken(cred);
  const res = await vFetch(`${base}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(order),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let j: Record<string, unknown> | null = null;
  try { j = JSON.parse(text); } catch { /* giữ null */ }
  if (!res.ok || j?.success === false) {
    throw new Error(`Vinaway order HTTP ${res.status}: ${String(j?.message ?? text).slice(0, 300)}`);
  }
  // Response: { success, message, internal_order_id, amount_total } → id đơn = internal_order_id.
  const id = j?.internal_order_id ?? j?.id ?? "";
  if (!id) throw new Error("Vinaway order: no internal_order_id in response (" + text.slice(0, 200) + ")");
  return { id: String(id), raw: j };
}

// Doc không kèm ví dụ response của products/product-skus → bóc MỀM: nhận cả mảng trần lẫn {data:[…]}, {total|pagination}.
const flexList = (j: unknown): Record<string, unknown>[] => {
  if (Array.isArray(j)) return j as Record<string, unknown>[];
  const o = (j ?? {}) as Record<string, unknown>;
  if (Array.isArray(o.data)) return o.data as Record<string, unknown>[];
  const anyArr = Object.values(o).find((v) => Array.isArray(v));
  return (anyArr as Record<string, unknown>[]) ?? [];
};
const flexTotal = (j: unknown, fallback: number): number => {
  const o = (j ?? {}) as Record<string, unknown>;
  const p = (o.pagination ?? {}) as Record<string, unknown>;
  return Number(o.total ?? p.total ?? p.count ?? 0) || fallback;
};

/** Danh sách SẢN PHẨM (id dùng làm product_id khi tạo đơn) — để ghép "product_id:sku_id" cho mapping. */
export async function listVinawayProducts(cred: VinawayCred, page = 1, limit = 100): Promise<{ total: number; data: { id: number; name: string; sku?: string }[] }> {
  const base = baseOf(cred.endpoint);
  const token = await vinawayToken(cred);
  const res = await vFetch(`${base}/api/products?page=${page}&limit=${limit}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vinaway products HTTP ${res.status}: ${text.slice(0, 200)}`);
  const j = JSON.parse(text) as unknown;
  const data = flexList(j).map((p) => ({ id: Number(p?.id) || 0, name: String(p?.name ?? p?.title ?? ""), sku: p?.sku ? String(p.sku) : undefined })).filter((p) => p.id);
  return { total: flexTotal(j, data.length), data };
}

/** Kéo danh sách variant SKU (id dùng làm product_sku_id khi tạo đơn) — phục vụ import SKU mapping. */
export async function listVinawaySkus(cred: VinawayCred, page = 1, limit = 100): Promise<{ total: number; data: { id: number; sku: string; product_id?: number; product_name?: string; color?: string; size?: string; price?: number }[] }> {
  const base = baseOf(cred.endpoint);
  const token = await vinawayToken(cred);
  const res = await vFetch(`${base}/api/product-skus?page=${page}&limit=${limit}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vinaway product-skus HTTP ${res.status}: ${text.slice(0, 200)}`);
  const j = JSON.parse(text) as unknown;
  const data = flexList(j).map((v) => ({
    id: Number(v?.id) || 0,
    sku: String(v?.sku ?? v?.code ?? ""),
    product_id: Number(v?.product_id) || undefined,
    product_name: v?.product_name ? String(v.product_name) : undefined,
    color: v?.color ? String(v.color) : undefined,
    size: v?.size ? String(v.size) : undefined,
    price: Number(v?.price) || undefined,
  })).filter((v) => v.id);
  return { total: flexTotal(j, data.length), data };
}
