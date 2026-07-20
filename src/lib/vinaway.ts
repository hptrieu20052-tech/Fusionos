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

// Response tối giản dùng chung cho fetch chuẩn lẫn đường vòng https.
type VResp = { ok: boolean; status: number; text: () => Promise<string> };

// ĐƯỜNG VÒNG khi cert Vinaway sai host (ERR_TLS_CERT_ALTNAME_INVALID — cert của gateway.vinaway.io
// không cấp cho chính domain đó): gọi bằng node:https với rejectUnauthorized=false, CHỈ áp cho Vinaway.
async function insecureFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string }): Promise<VResp> {
  const { request } = await import("node:https");
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request({
      hostname: u.hostname, port: Number(u.port) || 443, path: u.pathname + u.search,
      method: init.method || "GET", headers: init.headers,
      rejectUnauthorized: false, servername: u.hostname,
      timeout: 30000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({
        ok: (res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300,
        status: res.statusCode ?? 0,
        text: async () => Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout 30s")));
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

// fetch có CHẨN ĐOÁN: "fetch failed" của Node giấu nguyên nhân trong e.cause → lôi ra code cụ thể
// (ENOTFOUND sai domain · ECONNREFUSED/ETIMEDOUT firewall chặn · CERT_* lỗi chứng chỉ TLS…).
// Lỗi CERT/ALTNAME → tự thử lại qua insecureFetch (bỏ verify TLS) để không kẹt vì cert Vinaway cấu hình sai.
const vFetch = async (url: string, init: RequestInit): Promise<VResp> => {
  try {
    return await fetch(url, init);
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const code = String(err?.cause?.code ?? "");
    const detail = String(err?.cause?.message ?? err?.message ?? e);
    if (/CERT|ALTNAME|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code + " " + detail)) {
      try {
        return await insecureFetch(url, {
          method: init.method as string | undefined,
          headers: init.headers as Record<string, string> | undefined,
          body: typeof init.body === "string" ? init.body : undefined,
        });
      } catch (e2) {
        throw new Error(`Vinaway: cert TLS sai host (${code}) và gọi đường vòng cũng lỗi — ${String((e2 as Error)?.message ?? e2).slice(0, 200)}`);
      }
    }
    throw new Error(`Vinaway: không kết nối được ${url} — ${code || detail}. Nếu là ETIMEDOUT/ECONNREFUSED thì server Vinaway đang chặn IP nước ngoài (Vercel ở Mỹ) — báo Vinaway mở firewall cho server của bạn.`);
  }
};

// DÒ HOST + PREFIX: doc ghi gateway.vinaway.io/api/token nhưng cURL mẫu là {{baseUrl}}/token —
// tức prefix "/api" có thể có hoặc không, và host thật có thể là api.vinaway.io (PDF cũ).
// Thử: (endpoint user điền → gateway → api) × (/api → gốc) × (JSON body → query string).
// Login được ở đâu thì NHỚ prefix đó cho mọi lời gọi sau (orders/products/skus).
const apiCache = new Map<string, string>(); // email → API PREFIX hoạt động (vd https://api.vinaway.io/api)
const BASE_CANDIDATES = ["https://gateway.vinaway.io", "https://api.vinaway.io"];

async function tokenAt(api: string, cred: VinawayCred): Promise<string> {
  const key = `${api}|${cred.email}`;
  const hit = tokenCache.get(key);
  if (hit && hit.exp - 60_000 > Date.now()) return hit.token;
  const q = `email=${encodeURIComponent(cred.email)}&password=${encodeURIComponent(cred.password)}`;
  const attempts: { url: string; body?: string; headers: Record<string, string> }[] = [
    { url: `${api}/token`, body: JSON.stringify({ email: cred.email, password: cred.password }), headers: { "Content-Type": "application/json", Accept: "application/json" } },
    { url: `${api}/token?${q}`, headers: { Accept: "application/json" } },
  ];
  let lastErr = "";
  for (const a of attempts) {
    const res = await vFetch(a.url, { method: "POST", headers: a.headers, body: a.body, signal: AbortSignal.timeout(20000) })
      .catch((e) => { lastErr = String((e as Error)?.message ?? e); return null; });
    if (!res) continue;
    const text = await res.text();
    if (!res.ok) { lastErr = `Vinaway token HTTP ${res.status}: ${text.slice(0, 200)}`; continue; }
    let j: Record<string, unknown>;
    try { j = JSON.parse(text); } catch { lastErr = "Vinaway token: non-JSON response"; continue; }
    const token = String(j?.access_token ?? "");
    if (!token) { lastErr = "Vinaway token: no access_token (" + text.slice(0, 150) + ")"; continue; }
    const ttl = (Number(j?.expires_in) || 18000) * 1000;
    tokenCache.set(key, { token, exp: Date.now() + ttl });
    return token;
  }
  throw new Error(lastErr || "Vinaway token failed");
}

export async function vinawaySession(cred: VinawayCred): Promise<{ api: string; token: string }> {
  // Prefix đã dò được lần trước → dùng ngay
  const cachedApi = apiCache.get(cred.email);
  if (cachedApi) {
    try { return { api: cachedApi, token: await tokenAt(cachedApi, cred) }; }
    catch { apiCache.delete(cred.email); /* hết hạn/đổi hạ tầng → dò lại */ }
  }
  const seenB = new Set<string>();
  const bases = [baseOf(cred.endpoint), ...BASE_CANDIDATES].filter((b) => b && !seenB.has(b) && (seenB.add(b), true));
  let lastErr = "";
  for (const base of bases) {
    for (const api of [`${base}/api`, base]) {
      try {
        const token = await tokenAt(api, cred);
        apiCache.set(cred.email, api);
        return { api, token };
      } catch (e) {
        lastErr = String((e as Error)?.message ?? e);
        // Sai email/password (401/422) → đổi host/prefix cũng vô ích, dừng sớm
        if (/HTTP 401|HTTP 422/i.test(lastErr)) throw new Error(lastErr + " — kiểm tra lại email/password Vinaway trong Settings.");
      }
    }
  }
  throw new Error(lastErr || "Vinaway: no reachable API host");
}

// Giữ tương thích chỗ khác từng import vinawayToken
export async function vinawayToken(cred: VinawayCred): Promise<string> {
  return (await vinawaySession(cred)).token;
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
  const { api, token } = await vinawaySession(cred);
  const res = await vFetch(`${api}/orders`, {
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

// Bóc field MỀM: response Vinaway không có doc → thử mọi tên field Laravel hay dùng (kể cả object lồng).
const str = (v: unknown): string => (v == null ? "" : String(v)).trim();
const firstStr = (...vals: unknown[]): string | undefined => { for (const v of vals) { const s = str(v); if (s) return s; } return undefined; };
const firstNum = (...vals: unknown[]): number | undefined => { for (const v of vals) { const n = Number(v); if (Number.isFinite(n) && n > 0) return n; } return undefined; };

/** Danh sách SẢN PHẨM (id dùng làm product_id khi tạo đơn) — để ghép "product_id:sku_id" cho mapping. */
export async function listVinawayProducts(cred: VinawayCred, page = 1, limit = 100): Promise<{ total: number; data: { id: number; name: string; sku?: string }[]; sample?: string }> {
  const { api, token } = await vinawaySession(cred);
  const res = await vFetch(`${api}/products?page=${page}&limit=${limit}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vinaway products HTTP ${res.status}: ${text.slice(0, 200)}`);
  const j = JSON.parse(text) as unknown;
  const raw = flexList(j);
  const data = raw.map((p) => ({
    id: Number(p?.id) || 0,
    name: firstStr(p?.name, p?.title, p?.product_name, p?.productName) ?? "",
    sku: firstStr(p?.sku, p?.code, p?.sku_code),
  })).filter((p) => p.id);
  return { total: flexTotal(j, data.length), data, sample: raw.length ? JSON.stringify(raw[0]).slice(0, 600) : undefined };
}

/** Kéo danh sách variant SKU (id dùng làm product_sku_id khi tạo đơn) — phục vụ import SKU mapping. */
export async function listVinawaySkus(cred: VinawayCred, page = 1, limit = 100): Promise<{ total: number; data: { id: number; sku: string; product_id?: number; product_name?: string; color?: string; size?: string; price?: number }[]; sample?: string }> {
  const { api, token } = await vinawaySession(cred);
  const res = await vFetch(`${api}/product-skus?page=${page}&limit=${limit}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vinaway product-skus HTTP ${res.status}: ${text.slice(0, 200)}`);
  const j = JSON.parse(text) as unknown;
  const raw = flexList(j);
  const data = raw.map((v) => {
    const prod = (v?.product ?? {}) as Record<string, unknown>;
    return {
      id: Number(v?.id) || 0,
      sku: firstStr(v?.sku, v?.code, v?.sku_code, v?.skuCode, v?.name) ?? "",
      product_id: firstNum(v?.product_id, prod?.id, v?.productId),
      product_name: firstStr(v?.product_name, prod?.name, prod?.title, v?.productName),
      color: firstStr(v?.color, v?.color_name, (v?.attributes as Record<string, unknown>)?.color),
      size: firstStr(v?.size, v?.size_name, (v?.attributes as Record<string, unknown>)?.size),
      price: firstNum(v?.price, v?.base_price, v?.basePrice, v?.cost, prod?.price),
    };
  }).filter((v) => v.id);
  return { total: flexTotal(j, data.length), data, sample: raw.length ? JSON.stringify(raw[0]).slice(0, 600) : undefined };
}
