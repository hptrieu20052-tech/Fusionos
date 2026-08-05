// LENFUL V6 API (POD) — login lấy access_token rồi đẩy đơn.
// Doc: https://documenter.getpostman.com/view/1568587/2s8Yt1rouq
// Base mặc định: https://s-lencam.lenful.com
//   POST /api/seller/login            { user_name, password } → { access_token, expires }
//   POST /api/order/:store_id/create?isCheckOrderNumber=false  (Bearer) → { data: { id, status, message } }

export type LenfulCred = { endpoint?: string | null; userName: string; password: string };

// Cache token theo (endpoint + user) trong vòng đời instance — đỡ login mỗi đơn.
const tokenCache = new Map<string, { token: string; exp: number }>();

// Chuẩn hoá base: người dùng lỡ dán cả path (…/api/seller/login, …/api/product…) → tự cắt về gốc domain.
const baseOf = (endpoint?: string | null) => {
  let b = (endpoint || "https://s-lencam.lenful.com").trim().replace(/\/+$/, "");
  b = b.replace(/\/api(\/[a-z0-9/_-]*)?$/i, "");
  return b || "https://s-lencam.lenful.com";
};

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
  /** BẮT BUỘC — mã ship theo ưu tiên: 0 Standard · 1 Ground · 2 Express · 3 3-Days · 4 Special · 5 US Island · 6 WW Standard · 7 By Platform · 8 By Seller */
  shippings?: number[];
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

// Danh sách STORE của seller → id dùng làm :store_id khi tạo đơn.
// Doc không ghi rõ path → TỰ DÒ các path khả dĩ, path nào trả mảng hợp lệ thì dùng.
export async function listLenfulStores(cred: LenfulCred): Promise<{ id: string; title: string }[]> {
  const base = baseOf(cred.endpoint);
  const token = await lenfulToken(cred);
  const paths = ["/api/store", "/api/stores", "/api/store/list", "/api/seller/store", "/api/seller/stores", "/api/store?page=1&limit=50"];
  let lastErr = "";
  for (const p of paths) {
    const res = await fetch(`${base}${p}`, {
      headers: { Accept: "*/*", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    }).catch((e) => { lastErr = String(e?.message ?? e); return null; });
    if (!res) continue;
    const text = await res.text();
    if (!res.ok) { lastErr = `${p} → HTTP ${res.status}`; continue; }
    let j: unknown; try { j = JSON.parse(text); } catch { lastErr = `${p} → non-JSON`; continue; }
    const obj = j as Record<string, unknown>;
    const arr = (Array.isArray(j) ? j : Array.isArray(obj?.data) ? obj.data : Object.values(obj ?? {}).find((v) => Array.isArray(v)) ?? []) as Record<string, unknown>[];
    const out = arr.map((s) => ({ id: String(s?.id ?? s?._id ?? ""), title: String(s?.name ?? s?.title ?? s?.domain ?? "store") })).filter((s) => s.id);
    if (out.length) return out;
    lastErr = `${p} → empty list`;
  }
  throw new Error(`Lenful store list: ${lastErr} — mở portal Lenful → Store, ID store là chuỗi 24 ký tự trên URL, dán tay vào ô Store ID.`);
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

// ============================================================================
//  CHI TIẾT ĐƠN — API seller V6 KHÔNG công bố endpoint detail → thử lần lượt các path
//  hay gặp; path nào trả 2xx JSON thì dùng (poll đã throttle nên vài request 404 là rẻ).
//  Portal hiện: Summary (subtotal) · Shipping · Total · Payment/Transaction.
// ============================================================================

export async function getLenfulOrder(cred: LenfulCred & { storeId?: string }, id: string): Promise<Record<string, unknown> | null> {
  const token = await lenfulToken(cred);
  const base = baseOf(cred.endpoint);
  const sid = (cred.storeId ?? "").trim();
  const eid = encodeURIComponent(id);
  const paths = [
    sid ? `/api/order/${encodeURIComponent(sid)}/detail/${eid}` : "",
    sid ? `/api/order/${encodeURIComponent(sid)}/${eid}` : "",
    `/api/order/detail/${eid}`,
    `/api/order/${eid}`,
    `/api/seller/order/${eid}`,
  ].filter(Boolean);
  for (const p of paths) {
    try {
      const res = await fetch(`${base}${p}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const j = JSON.parse(await res.text()) as Record<string, unknown>;
      const d = ((j?.data ?? j.order ?? j) ?? null) as Record<string, unknown> | null;
      if (d && typeof d === "object" && Object.keys(d).length) return d;
    } catch { /* thử path kế tiếp */ }
  }
  return null;
}

const lNum = (...vals: unknown[]): number | undefined => { for (const v of vals) { const n = Number(v); if (Number.isFinite(n) && n > 0) return n; } return undefined; };
const lStr = (...vals: unknown[]): string | undefined => { for (const v of vals) { const s = (v == null ? "" : String(v)).trim(); if (s) return s; } return undefined; };

/** Bóc chi phí + tracking từ detail Lenful (dò mềm nhiều tên field). */
export function extractLenfulOrder(root: Record<string, unknown>): {
  status?: string; trackingNumber?: string; carrier?: string;
  base?: number; ship?: number; tax?: number; total?: number;
} {
  const o: Record<string, unknown> = {
    ...root,
    ...((root.pricing as Record<string, unknown>) ?? {}),
    ...((root.summary as Record<string, unknown>) ?? {}),
  };
  const track = ((o.tracking ?? o.shipment ?? {}) as Record<string, unknown>);
  // Tên field trực tiếp không trúng (đơn thật chỉ bóc được total, ship rơi vào base) → DÒ SÂU
  // toàn bộ cây JSON (≤3 tầng) theo pattern tên tiền. Bỏ qua mảng để không dính "shippings":[0,1,2]
  // (mảng MÃ shipping method lúc đẩy đơn — không phải tiền!).
  const deepNum = (obj: unknown, re: RegExp, depth = 0): number | undefined => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj) || depth > 3) return undefined;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (re.test(k) && !Array.isArray(v) && (typeof v === "number" || typeof v === "string")) {
        const n = Number(v); if (Number.isFinite(n) && n > 0) return n;
      }
    }
    for (const v of Object.values(obj as Record<string, unknown>)) {
      const r = deepNum(v, re, depth + 1); if (r !== undefined) return r;
    }
    return undefined;
  };
  // TÊN FIELD THẬT (xác nhận từ ff-debug đơn GUTLINGARTSSHOP-4126087553):
  //   root.subtotal_price = 5.5 (base) · root.total_price = 13 (total)
  //   SHIP KHÔNG có ở root — nằm trong items[]: mỗi item có shipping_price (7.5) + shipping_xbase
  //   (first_item_price/second_item_price chỉ là BẢNG GIÁ tier, không cộng!)
  const items = Array.isArray(root.items) ? (root.items as Record<string, unknown>[]) : [];
  const shipFromItems = Math.round(items.reduce((s, it) => s + (Number(it?.shipping_price) || 0) + (Number(it?.shipping_xbase) || 0), 0) * 100) / 100;
  // v167 — root.items KHÔNG TỒN TẠI ở đơn thật (Lenful gọi là `line_items`, mà line_items lại
  // không mang tiền ship). Tiền ship nằm ở root.shipping_method.price (+ .xbase), và chi tiết
  // theo từng dòng ở shipping_method.items[].shipping_price. Vì deepNum cố tình không đi vào
  // mảng nên nó cũng không bao giờ chạm tới → ship về undefined và $8.50 bị dồn hết sang
  // "Other fee". Tổng vẫn đúng, nhưng nhãn sai ở mọi đơn Lenful.
  const shipMethod = (root.shipping_method ?? {}) as Record<string, unknown>;
  const shipFromMethod = Math.round(((Number(shipMethod.price) || 0) + (Number(shipMethod.xbase) || 0)) * 100) / 100;
  const smItems = Array.isArray(shipMethod.items) ? (shipMethod.items as Record<string, unknown>[]) : [];
  const shipFromSmItems = Math.round(smItems.reduce((s, it) => s + (Number(it?.shipping_price) || 0) + (Number(it?.shipping_xbase) || 0), 0) * 100) / 100;
  const base = lNum(o.subtotal_price, o.subtotal, o.sub_total, o.summary_amount, o.items_total, o.total_item)
    ?? deepNum(root, /^(sub.?total([._-]?price)?|summary|item.?(total|price|amount)|product.?(total|price|amount))$/i);
  const ship = lNum(o.shipping_fee, o.shipping, o.ship_fee, o.shipping_price, o.shipping_cost)
    ?? (shipFromMethod > 0 ? shipFromMethod : undefined)
    ?? (shipFromSmItems > 0 ? shipFromSmItems : undefined)
    ?? (shipFromItems > 0 ? shipFromItems : undefined)
    ?? deepNum(root, /^(ship(ping)?[._-]?(fee|cost|price|amount|total)|fee[._-]?ship(ping)?|total[._-]?ship(ping)?)$/i);
  const tax = lNum(o.tax, o.tax_amount, o.tax_fee) ?? deepNum(root, /^(tax([._-]?(fee|amount|total))?)$/i);
  const total = lNum(o.total_price, o.total, o.total_amount, o.grand_total, o.amount)
    ?? deepNum(root, /^(grand.?total|total([._-]?(price|amount|cost))?)$/i);
  // TRACKING: y hệt bài học của SHIP — số tiền ship không nằm ở root mà trong items[].
  // Tracking cũng vậy: Lenful gắn mã vận đơn theo TỪNG ITEM / package, không phải ở root.
  // BUG CŨ: chỉ dò root + root.tracking (object) → đơn đã ship vẫn về trackingNumber = undefined,
  // nên applyUpdate không đổi gì và Etsy/TikTok/Shopify không bao giờ được đẩy tracking.
  // deepStr đi XUYÊN CẢ MẢNG (deepNum cố tình không, vì sợ dính "shippings":[0,1,2] — mã ship,
  // không phải tiền; với chuỗi thì không có bẫy đó).
  const deepStr = (obj: unknown, re: RegExp, depth = 0): string | undefined => {
    if (!obj || typeof obj !== "object" || depth > 4) return undefined;
    const entries: [string, unknown][] = Array.isArray(obj)
      ? (obj as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
      : Object.entries(obj as Record<string, unknown>);
    for (const [k, v] of entries) {
      if (v === null || typeof v === "object") continue;
      if (!re.test(k)) continue;
      const s = String(v).trim();
      if (s && s.toLowerCase() !== "null") return s;
    }
    for (const [, v] of entries) { const r = deepStr(v, re, depth + 1); if (r) return r; }
    return undefined;
  };
  const L_TRACK_RE = /^(tracking[._-]?(number|code|no)|trackingnumber|track[._-]?(number|code)|awb([._-]?(code|number))?)$/i;
  const L_CARRIER_RE = /^(carrier([._-]?(code|name))?|shipping[._-]?carrier|tracking[._-]?company|courier)$/i;

  // v167 — CẤU TRÚC THẬT (xác nhận từ raw ff-debug đơn ZINASHOPFUN-4126448923):
  //   root.fulfillments[].trackings[] = { company:"USPS", number:"92001903840…", status:"InTransit",
  //                                       created_at, isHidden, translation:{name}, events[] }
  // Key là "number"/"company" TRẦN → mọi regex cũ (tracking_number/awb/…) đều trượt, và root
  // không hề có object `tracking`. Hệ quả: MỌI đơn Lenful đều về trackingNumber = undefined,
  // nên không đơn nào được đẩy tracking sang Etsy/TikTok/Shopify. Đọc thẳng đúng đường dẫn,
  // KHÔNG nới regex thành /^number$/ (sẽ dính đủ thứ field "number" khác trong cây JSON).
  let fNum: string | undefined, fCarrier: string | undefined, fStatus: string | undefined, fAt = "";
  for (const f of (Array.isArray(root.fulfillments) ? (root.fulfillments as Record<string, unknown>[]) : [])) {
    for (const t of (Array.isArray(f?.trackings) ? (f.trackings as Record<string, unknown>[]) : [])) {
      if (t?.isHidden === true) continue;
      const num = String(t?.number ?? "").trim();
      if (!num || num.toLowerCase() === "null") continue;
      const at = String(t?.created_at ?? "");
      if (fNum && at <= fAt) continue; // nhiều package → giữ tracking mới nhất
      fNum = num; fAt = at;
      fCarrier = lStr((t?.translation as Record<string, unknown>)?.name, t?.company);
      fStatus = lStr(t?.status);
    }
  }
  // Trạng thái đơn ở root vẫn là "Fulfillment" kể cả khi kiện đã Delivered → ưu tiên trạng thái
  // của chính tracking khi nó đã giao xong, để mapGenericStatus không kẹt ở "shipped".
  const statusOut = (fStatus && /deliver/i.test(fStatus) && !/out.?for.?deliver/i.test(fStatus))
    ? "Delivered"
    : lStr(o.status, o.order_status, o.state);

  return {
    status: statusOut,
    trackingNumber: fNum
      ?? lStr(o.tracking_number, o.tracking_code, o.trackingNumber, track.tracking_number, track.code, track.number)
      ?? deepStr(root, L_TRACK_RE),
    carrier: fCarrier
      ?? lStr(o.carrier, o.shipping_carrier, o.tracking_company, track.carrier, track.company)
      ?? deepStr(root, L_CARRIER_RE),
    base, ship, tax, total,
  };
}
