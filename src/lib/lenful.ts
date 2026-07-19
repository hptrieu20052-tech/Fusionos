// LENFUL V6 API (POD) — login lấy access_token rồi đẩy đơn.
// Doc: https://documenter.getpostman.com/view/1568587/2s8Yt1rouq
// Base mặc định: https://s-lencam.lenful.com
//   POST /api/seller/login            { user_name, password } → { access_token, expires }
//   POST /api/order/:store_id/create?isCheckOrderNumber=false  (Bearer) → { data: { id, status, message } }

export type LenfulCred = { endpoint?: string | null; userName: string; password: string };

// Cache token theo (endpoint + user) trong vòng đời instance — đỡ login mỗi đơn.
const tokenCache = new Map<string, { token: string; exp: number }>();

const baseOf = (endpoint?: string | null) => (endpoint || "https://s-lencam.lenful.com").replace(/\/+$/, "");

export async function lenfulToken(cred: LenfulCred): Promise<string> {
  const base = baseOf(cred.endpoint);
  const key = `${base}|${cred.userName}`;
  const hit = tokenCache.get(key);
  if (hit && hit.exp - 60_000 > Date.now()) return hit.token;

  // Doc Postman khai field dạng "text" = FORM-DATA (server ASP.NET trả 400 validation nếu gửi JSON).
  // Thử lần lượt: multipart form-data → x-www-form-urlencoded → JSON; dạng nào ăn thì dùng.
  const attempts: { headers?: Record<string, string>; body: BodyInit }[] = [
    (() => { const fd = new FormData(); fd.set("user_name", cred.userName); fd.set("password", cred.password); return { body: fd }; })(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ user_name: cred.userName, password: cred.password }).toString() },
    { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_name: cred.userName, password: cred.password }) },
  ];
  let lastErr = "";
  for (const a of attempts) {
    const res = await fetch(`${base}/api/seller/login`, {
      method: "POST",
      headers: { Accept: "*/*", ...(a.headers ?? {}) },
      body: a.body,
      signal: AbortSignal.timeout(20000),
    }).catch((e) => { lastErr = String(e?.message ?? e); return null; });
    if (!res) continue;
    const text = await res.text();
    if (!res.ok) { lastErr = `HTTP ${res.status}: ${text.slice(0, 200)}`; continue; }
    let j: Record<string, unknown>;
    try { j = JSON.parse(text); } catch { lastErr = "non-JSON response"; continue; }
    const d = (j?.data ?? j) as Record<string, unknown>;
    const token = String(d?.access_token ?? "");
    if (!token) { lastErr = "no access_token (" + text.slice(0, 150) + ")"; continue; }
    const rawExp = Number(d?.expires) || 0;
    const exp = rawExp > 1e12 ? rawExp : rawExp > 0 ? rawExp * 1000 : Date.now() + 3600_000;
    tokenCache.set(key, { token, exp });
    return token;
  }
  throw new Error(`Lenful login failed: ${lastErr}`);
}

// Vị trí in Lenful: 0 Full · 1 Front · 2 Back · 3 LeftChest · 4 RightChest · 5 LeftSleeve · 6 RightSleeve · 7 Neck · 8 Full3D
export type LenfulDesign = { position: number; link: string; link_blueprint?: string };
export type LenfulItem = {
  design_sku: string;
  product_sku: string;
  quantity: number;
  mockups?: string[];
  designs?: LenfulDesign[];
  embroidereds?: LenfulDesign[];
  request_clone?: boolean;
  shippings?: string[];
};
export type LenfulOrder = {
  order_number: string;
  first_name?: string; last_name?: string; email?: string; phone?: string;
  country_code?: string; province?: string; city?: string; zip?: string;
  address_1?: string; address_2?: string; note?: string;
  /** Link nhãn ship (đơn Ship-by-TikTok) */
  platform_label?: string;
  items: LenfulItem[];
};

// Danh mục sản phẩm: GET /api/product?page&limit&published=true → { pagination:{count,total_page}, data:[{id,name,variant_default:{sku,name,full_name,price,base_cost}}] }
// LƯU Ý: chỉ trả variant MẶC ĐỊNH của mỗi sản phẩm; variant khác (màu/size) lấy qua "Get a single product".
export type LenfulProduct = {
  id: string; name: string;
  variant_default?: { sku?: string; name?: string; full_name?: string; price?: number; base_cost?: number };
};
export async function listLenfulProducts(cred: LenfulCred, page = 1, limit = 250): Promise<{ totalPage: number; count: number; data: LenfulProduct[] }> {
  const base = baseOf(cred.endpoint);
  const token = await lenfulToken(cred);
  const res = await fetch(`${base}/api/product?page=${page}&limit=${limit}&published=true`, {
    headers: { Accept: "*/*", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Lenful product list HTTP ${res.status}: ${text.slice(0, 200)}`);
  const j = JSON.parse(text) as { pagination?: { count?: number; total_page?: number }; data?: LenfulProduct[] };
  return { totalPage: Number(j?.pagination?.total_page) || 1, count: Number(j?.pagination?.count) || 0, data: Array.isArray(j?.data) ? j.data : [] };
}

// Danh sách STORE của seller: GET /api/store → id dùng làm :store_id khi tạo đơn.
export async function listLenfulStores(cred: LenfulCred): Promise<{ id: string; title: string }[]> {
  const base = baseOf(cred.endpoint);
  const token = await lenfulToken(cred);
  const res = await fetch(`${base}/api/store`, {
    headers: { Accept: "*/*", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Lenful store list HTTP ${res.status}: ${text.slice(0, 200)}`);
  let j: unknown; try { j = JSON.parse(text); } catch { throw new Error("Lenful store list: non-JSON"); }
  // Chịu nhiều dạng: mảng trực tiếp | {data:[…]} | object chứa 1 mảng bất kỳ.
  const obj = j as Record<string, unknown>;
  const arr = (Array.isArray(j) ? j : Array.isArray(obj?.data) ? obj.data : Object.values(obj ?? {}).find((v) => Array.isArray(v)) ?? []) as Record<string, unknown>[];
  return arr.map((s) => ({ id: String(s?.id ?? s?._id ?? ""), title: String(s?.name ?? s?.title ?? s?.domain ?? "store") })).filter((s) => s.id);
}

// Chi tiết 1 sản phẩm: GET /api/product/:product_id → có MẢNG variants đầy đủ (mỗi variant 1 SKU riêng).
export type LenfulVariant = { id?: string; name?: string; full_name?: string; sku?: string; price?: number; base_cost?: number; status?: boolean };
export async function getLenfulProduct(cred: LenfulCred, productId: string): Promise<{ id: string; name: string; variants: LenfulVariant[] }> {
  const base = baseOf(cred.endpoint);
  const token = await lenfulToken(cred);
  const res = await fetch(`${base}/api/product/${encodeURIComponent(productId)}`, {
    headers: { Accept: "*/*", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Lenful product HTTP ${res.status}: ${text.slice(0, 200)}`);
  const j = JSON.parse(text) as { id?: string; name?: string; variants?: LenfulVariant[]; variant_default?: LenfulVariant };
  const variants = Array.isArray(j?.variants) && j.variants.length ? j.variants : (j?.variant_default ? [j.variant_default] : []);
  return { id: String(j?.id ?? productId), name: String(j?.name ?? ""), variants };
}

export async function createLenfulOrder(cred: LenfulCred & { storeId: string }, order: LenfulOrder): Promise<{ id: string; raw: unknown }> {
  const base = baseOf(cred.endpoint);
  const token = await lenfulToken(cred);
  const res = await fetch(`${base}/api/order/${encodeURIComponent(cred.storeId)}/create?isCheckOrderNumber=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(order),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let j: Record<string, unknown> | null = null;
  try { j = JSON.parse(text); } catch { /* giữ null */ }
  const d = (j?.data ?? j ?? {}) as Record<string, unknown>;
  if (!res.ok || d?.status === false) {
    throw new Error(`Lenful order HTTP ${res.status}: ${String(d?.message ?? text).slice(0, 300)}`);
  }
  const id = d?.id ?? d?.order_id ?? "";
  if (!id) throw new Error("Lenful order: no order id in response (" + text.slice(0, 200) + ")");
  return { id: String(id), raw: j };
}
