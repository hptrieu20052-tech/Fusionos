// VINAWAY API (POD) — Bearer token từ email/password, đẩy đơn production.
// Doc: https://vinaway.io/api-docs (PDF seller cung cấp 2026-07)
// Base: https://api.vinaway.io/api (dev: https://dev.api.vinaway.io/api)
//   POST /token            { email, password } → { access_token, token_type: "Bearer", expires_in: 18000 (giây) }
//   POST /orders           → { success, message, id, internal_order_id }
//   GET  /orders/{internal_order_id} · GET /orders?page&limit
//   GET  /production-lines (1 Standard, 2 Express) · GET /products · GET /product-skus (variant id dùng khi tạo đơn)

export type VinawayCred = { endpoint?: string | null; email: string; password: string };

const tokenCache = new Map<string, { token: string; exp: number }>();
const baseOf = (endpoint?: string | null) => (endpoint || "https://api.vinaway.io/api").replace(/\/+$/, "");

export async function vinawayToken(cred: VinawayCred): Promise<string> {
  const base = baseOf(cred.endpoint);
  const key = `${base}|${cred.email}`;
  const hit = tokenCache.get(key);
  if (hit && hit.exp - 60_000 > Date.now()) return hit.token;

  const res = await fetch(`${base}/token`, {
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
  product_id: number;
  product_sku_id: number;
  quantity: number;
  mockup1?: string;
  productSurfaces?: VinawaySurface[];
};
export type VinawayOrder = {
  /** 1 Production · 2 Dropship · 3 Design */
  type: number;
  external_order_id?: string;
  /** 1 Standard · 2 Express (GET /production-lines) */
  production_line_id: number;
  customer_name: string;
  address1?: string; city?: string; zip?: string; country?: string; state?: string;
  items: VinawayItem[];
};

export async function createVinawayOrder(cred: VinawayCred, order: VinawayOrder): Promise<{ id: string; raw: unknown }> {
  const base = baseOf(cred.endpoint);
  const token = await vinawayToken(cred);
  const res = await fetch(`${base}/orders`, {
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
  // Ưu tiên internal_order_id (dùng cho GET /orders/{id}); fallback id số.
  const id = j?.internal_order_id ?? j?.id ?? "";
  if (!id) throw new Error("Vinaway order: no order id in response (" + text.slice(0, 200) + ")");
  return { id: String(id), raw: j };
}

/** Danh sách SẢN PHẨM (id dùng làm product_id khi tạo đơn) — để ghép "product_id:sku_id" cho mapping. */
export async function listVinawayProducts(cred: VinawayCred, page = 1, limit = 100): Promise<{ total: number; data: { id: number; name: string; sku?: string }[] }> {
  const base = baseOf(cred.endpoint);
  const token = await vinawayToken(cred);
  const res = await fetch(`${base}/products?page=${page}&limit=${limit}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vinaway products HTTP ${res.status}: ${text.slice(0, 200)}`);
  const j = JSON.parse(text) as { total?: number; data?: { id: number; name: string; sku?: string }[] };
  return { total: Number(j?.total) || 0, data: Array.isArray(j?.data) ? j.data : [] };
}

/** Kéo danh sách variant SKU (id dùng làm product_sku_id khi tạo đơn) — phục vụ import SKU mapping. */
export async function listVinawaySkus(cred: VinawayCred, page = 1, limit = 100): Promise<{ total: number; data: { id: number; sku: string; product_name?: string; color?: string; size?: string }[] }> {
  const base = baseOf(cred.endpoint);
  const token = await vinawayToken(cred);
  const res = await fetch(`${base}/product-skus?page=${page}&limit=${limit}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vinaway product-skus HTTP ${res.status}: ${text.slice(0, 200)}`);
  const j = JSON.parse(text) as { total?: number; data?: { id: number; sku: string; product_name?: string; color?: string; size?: string }[] };
  return { total: Number(j?.total) || 0, data: Array.isArray(j?.data) ? j.data : [] };
}
