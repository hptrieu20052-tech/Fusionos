/**
 * HOGOTO POD — Partner API (https://seller.hogotopod.com/api).
 * Xác thực bằng header X-API-Key + X-Tenant (mặc định "fulfillment").
 * Đẩy đơn: POST /v1/partner/order/store.
 * Doc mẫu 2026-07 (cURL order/store).
 */

export type HogotoCfg = { endpoint: string; apiKey: string; tenant: string };
export type HogotoResult = { orderCode: string; baseCost?: number; shipCost?: number; raw: unknown };

const num = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

/** Ghép URL: endpoint có thể là ".../api" hoặc gốc → luôn ra ".../api/v1/partner/...". */
function apiUrl(endpoint: string, path: string): string {
  let base = (endpoint || "https://seller.hogotopod.com/api").replace(/\/+$/, "");
  if (!/\/api$/i.test(base)) base += "/api";
  return base + path;
}

export async function createHogotoOrder(cfg: HogotoCfg, body: unknown): Promise<HogotoResult> {
  const res = await fetch(apiUrl(cfg.endpoint, "/v1/partner/order/store"), {
    method: "POST",
    headers: { "X-API-Key": cfg.apiKey, "X-Tenant": cfg.tenant || "fulfillment", "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let j: Record<string, unknown> = {};
  try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  if (!res.ok) {
    const msg = (typeof j.message === "string" && j.message) || (typeof j.error === "string" && j.error) || text.slice(0, 400);
    throw new Error(`Hogoto HTTP ${res.status}: ${msg}`);
  }
  // v145 · Hogoto CÓ THỂ trả HTTP 200 kèm envelope LỖI, ví dụ:
  //   { "code": "VALIDATION_ERROR", "message": "...", "data": null }
  // Bản cũ lấy luôn `j.code` làm orderCode ⇒ đơn hiện PUSHED với mã "VALIDATION_ERROR"
  // trong khi bên seller.hogotopod.com KHÔNG hề có đơn. Phải coi đây là THẤT BẠI.
  const hasData = !!j.data && typeof j.data === "object" && !Array.isArray(j.data);
  const data = (hasData ? j.data : j) as Record<string, unknown>;

  // Chỉ nhận các khoá THỰC SỰ là mã đơn. Không bao giờ lấy `code` ở cấp envelope
  // (đó là mã trạng thái/mã lỗi), chỉ chấp nhận `code` khi nó nằm trong data{}.
  const orderObj = (typeof data.order === "object" && data.order ? data.order : {}) as Record<string, unknown>;
  let orderCode = String(
    data.orderCode ?? data.order_code ?? data.referenceCode ?? data.reference_code ??
    orderObj.orderCode ?? orderObj.code ?? "",
  ).trim();
  if (!orderCode && hasData) orderCode = String(data.code ?? data.id ?? "").trim();

  // Cờ lỗi ở cấp envelope: code chữ có mùi lỗi, success=false, hoặc status/statusCode >= 400.
  const envCode = typeof j.code === "string" ? j.code.trim() : "";
  const envStatus = num(j.status ?? j.statusCode ?? j.httpStatus);
  const errish =
    /error|fail|invalid|denied|unauthor|forbid|missing|reject|exception|not_?found/i.test(envCode) ||
    (typeof j.success === "boolean" && j.success === false) ||
    (envStatus !== undefined && envStatus >= 400);

  if (errish || !orderCode) {
    // Gom mọi mô tả lỗi Hogoto trả về để hiện nguyên văn trong toast — không nuốt lỗi,
    // không bịa mã đơn. Thiếu message thì in thẳng body để còn biết trường nào sai.
    const bits: string[] = [];
    for (const k of ["message", "error", "detail", "details", "errorMessage", "description"]) {
      const v = j[k];
      if (typeof v === "string" && v.trim()) bits.push(v.trim());
    }
    const errArr = Array.isArray(j.errors) ? j.errors : Array.isArray((j as Record<string, unknown>).violations) ? (j as Record<string, unknown>).violations : null;
    if (Array.isArray(errArr)) {
      for (const e of errArr.slice(0, 6)) {
        if (typeof e === "string") bits.push(e);
        else if (e && typeof e === "object") {
          const o = e as Record<string, unknown>;
          const f = String(o.field ?? o.property ?? o.path ?? "").trim();
          const m = String(o.message ?? o.error ?? o.defaultMessage ?? "").trim();
          if (f || m) bits.push(f ? `${f}: ${m}` : m);
        }
      }
    }
    const detail = bits.join(" · ") || text.slice(0, 500) || "(Hogoto không trả nội dung)";
    throw new Error(`Hogoto từ chối đơn${envCode ? ` [${envCode}]` : ""}: ${detail}`);
  }

  const baseCost = num(data.baseCost ?? data.productAmount ?? data.itemsAmount ?? data.itemAmount);
  const shipCost = num(data.shippingFee ?? data.shippingAmount ?? data.shipping_fee);
  return { orderCode, baseCost, shipCost, raw: j };
}


// ===== KÉO CATALOG → dựng SKU mapping =====
// GET /v1/product chỉ trả CẤP SẢN PHẨM (P199 "Embroidedy Pillow Cover", sku "Goi") — KHÔNG kèm
// variation. Portal thì có: 4 dòng size ("S vỏ gối", "M vỏ gối", "S vỏ gối+ruột", "M vỏ gối+ruột")
// với sku riêng (Goi_S VỎ GỐI...) và giá theo TỪNG PHƯƠNG THỨC SHIP (Fast US, Ship by TikTok US,
// ePacket, Outside US, To UK...). Vì vậy phải gọi thêm endpoint chi tiết cho từng sản phẩm.
// Không có doc → dò lần lượt vài dạng URL trên SẢN PHẨM ĐẦU TIÊN, dạng nào trả về variation thì
// dùng dạng đó cho toàn bộ 189 sản phẩm.
export type HogotoRow = {
  productCode: string; name: string; sku: string; size: string;
  positionCode: string | null; productType: string | null; baseCost: number; shipCost: number;
  prices?: Record<string, number>; image?: string | null;
};

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const asArray = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

/** Bóc mảng sản phẩm ở nhiều kiểu bọc: data / data.content / content / mảng phẳng. */
function pickProducts(j: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(j)) return j as Record<string, unknown>[];
  const d = j.data as Record<string, unknown> | undefined;
  if (Array.isArray(d)) return d as unknown as Record<string, unknown>[];
  if (d && Array.isArray(d.content)) return d.content as Record<string, unknown>[];
  if (Array.isArray(j.content)) return j.content as Record<string, unknown>[];
  if (d && Array.isArray(d.items)) return d.items as Record<string, unknown>[];
  return [];
}

const normKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * TÌM MẢNG VARIATION Ở BẤT KỲ ĐỘ SÂU NÀO. Không đoán tên field (variations/variants/skus/items/
 * children/...) vì Hogoto đặt tên gì cũng được — chỉ cần là mảng object mà phần tử có size/sku.
 */
function deepFindVariations(root: unknown): Record<string, unknown>[] {
  const queue: unknown[] = [root];
  let guard = 0;
  while (queue.length && guard++ < 2000) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      const objs = cur.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
      const looksLikeVariation = objs.length > 0 && objs.every((o) => {
        const keys = Object.keys(o).map(normKey);
        return keys.some((k) => k === "size" || k === "sizename" || k === "variantname") ||
               keys.some((k) => k === "sku" || k === "skucode");
      });
      if (looksLikeVariation) return objs;
      for (const x of cur) queue.push(x);
      continue;
    }
    for (const v of Object.values(cur as Record<string, unknown>)) queue.push(v);
  }
  return [];
}

/** Gom mọi field số của variation → { tênĐãChuẩnHoá: giá }. Giữ nguyên để không mất dữ liệu giá. */
function collectPrices(v: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v)) {
    const n = num(val);
    if (n == null || !Number.isFinite(n) || n <= 0) continue;
    const nk = normKey(k);
    if (nk === "id" || nk === "productid" || nk === "quantity" || nk === "stock" || nk.endsWith("code")) continue;
    out[k] = n;
  }
  return out;
}

// Giá trong portal là TỔNG cho từng phương thức ship (không tách base/ship) → chọn đúng cột hay
// dùng nhất làm base, ship = 0, và cất toàn bộ bảng giá vào extraJson để đối chiếu sau.
const PRICE_PREFERENCE = [
  "fastusshipping", "fastus", "shipbytiktokus", "tiktokus", "epacketusshipping", "epacketus",
  "baseprice", "basecost", "price", "cost", "shippingoutsideus", "shippingtouk", "shippingtiktokuk",
];

function pickBaseCost(prices: Record<string, number>): number {
  const byNorm: Record<string, number> = {};
  for (const [k, v] of Object.entries(prices)) byNorm[normKey(k)] = v;
  for (const p of PRICE_PREFERENCE) { const hit = byNorm[p]; if (hit != null) return hit; }
  for (const p of PRICE_PREFERENCE) {
    for (const [k, v] of Object.entries(byNorm)) if (k.includes(p)) return v;
  }
  const all = Object.values(byNorm);
  return all.length ? Math.min(...all) : 0;
}

/** Ảnh đại diện sản phẩm — tên field mỗi nhà mỗi khác nên thử lần lượt, kể cả mảng ảnh. */
function pickImage(p: Record<string, unknown>): string | null {
  const direct = str(p.image ?? p.imageUrl ?? p.thumbnail ?? p.thumbnailUrl ?? p.avatar ?? p.photo ?? p.mockup ?? p.mockupUrl);
  if (/^https?:\/\//i.test(direct)) return direct;
  for (const key of ["images", "imageAlbum", "album", "photos", "mockups", "gallery"]) {
    const arr = p[key];
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      const u = typeof it === "string" ? it : str((it as Record<string, unknown>)?.url ?? (it as Record<string, unknown>)?.src ?? (it as Record<string, unknown>)?.image);
      if (/^https?:\/\//i.test(u)) return u;
    }
  }
  return null;
}

/** Ảnh nằm sâu trong JSON chi tiết → quét tìm URL ảnh đầu tiên. */
function deepFindImage(root: unknown): string | null {
  const queue: unknown[] = [root];
  let guard = 0;
  while (queue.length && guard++ < 3000) {
    const cur = queue.shift();
    if (typeof cur === "string") {
      if (/^https?:\/\/\S+\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(cur)) return cur;
      continue;
    }
    if (!cur || typeof cur !== "object") continue;
    for (const v of Object.values(cur as Record<string, unknown>)) queue.push(v);
  }
  return null;
}

function rowsFromProduct(p: Record<string, unknown>, variations: Record<string, unknown>[], fallbackImage?: string | null): HogotoRow[] {
  const productCode = str(p.productCode ?? p.code ?? p.product_code);
  const name = str(p.name ?? p.title ?? p.productName);
  const positionCode = str(p.positionCode ?? p.printPosition ?? p.print_position ?? p.printLocation) || null;
  const productType = str(p.productType ?? p.type ?? p.product_type) || null;
  const pSku = str(p.sku);
  const image = pickImage(p) ?? fallbackImage ?? null;
  if (!variations.length) {
    return [{ productCode, name, sku: pSku || productCode, size: "", positionCode, productType, baseCost: 0, shipCost: 0, image }];
  }
  const rows: HogotoRow[] = [];
  for (const v of variations) {
    const size = str(v.size ?? v.sizeName ?? v.variantName ?? v.name);
    const sku = str(v.sku ?? v.skuCode ?? v.code) || (pSku ? `${pSku}_${size}` : `${productCode}_${size}`);
    const prices = collectPrices(v);
    rows.push({
      productCode, name, sku, size, positionCode, productType,
      baseCost: pickBaseCost(prices), shipCost: 0, prices, image: pickImage(v) ?? image,
    });
  }
  return rows;
}

async function getJson(url: string, cfg: HogotoCfg): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    headers: { "X-API-Key": cfg.apiKey, "X-Tenant": cfg.tenant || "fulfillment", Accept: "application/json" },
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 400) }; }
  return { status: res.status, json };
}

/** Các dạng URL chi tiết có thể có — dò trên 1 sản phẩm rồi khoá lại 1 dạng. */
function detailCandidates(p: Record<string, unknown>): string[] {
  const code = encodeURIComponent(str(p.productCode ?? p.code ?? p.product_code));
  const id = str(p.id);
  const list = [
    `/v1/product/${code}`,
    `/v1/product/detail/${code}`,
    `/v1/product/${code}/variation`,
    `/v1/product/${code}/variations`,
    `/v1/product/variation?productCode=${code}`,
    `/v1/product?productCode=${code}`,
  ];
  if (id && id !== code) list.splice(1, 0, `/v1/product/${encodeURIComponent(id)}`);
  return list;
}

export type HogotoProbe = { url: string; status: number; variations: number };

export async function listHogotoProducts(
  cfg: HogotoCfg,
  opts?: { deadlineMs?: number },
): Promise<{ rows: HogotoRow[]; sample: unknown; count: number; probes: HogotoProbe[]; detailPattern: string | null; detailed: number }> {
  const started = Date.now();
  const budget = opts?.deadlineMs ?? 45_000;
  const timeLeft = () => budget - (Date.now() - started);

  const first = await getJson(apiUrl(cfg.endpoint, "/v1/product"), cfg);
  if (first.status < 200 || first.status >= 300) {
    const j = (first.json ?? {}) as Record<string, unknown>;
    throw new Error(`Hogoto GET /v1/product HTTP ${first.status}: ${str(j.message) || JSON.stringify(j).slice(0, 300)}`);
  }
  const products = pickProducts((first.json ?? {}) as Record<string, unknown>);
  const probes: HogotoProbe[] = [];

  // 1) Nếu list đã kèm variation thì khỏi gọi thêm.
  const inline = products.map((p) => deepFindVariations(p));
  const hasInline = inline.some((v) => v.length > 0);
  if (hasInline) {
    const rows = products.flatMap((p, i) => rowsFromProduct(p, inline[i]));
    return { rows, sample: products[0] ?? first.json, count: products.length, probes, detailPattern: "inline", detailed: products.length };
  }

  // 2) Dò dạng URL chi tiết trên sản phẩm đầu tiên.
  let pattern: string | null = null;
  const p0 = products[0];
  if (p0) {
    for (const path of detailCandidates(p0)) {
      if (timeLeft() < 8000) break;
      let r: { status: number; json: unknown };
      try { r = await getJson(apiUrl(cfg.endpoint, path), cfg); } catch { probes.push({ url: path, status: 0, variations: 0 }); continue; }
      const vs = r.status >= 200 && r.status < 300 ? deepFindVariations(r.json) : [];
      probes.push({ url: path, status: r.status, variations: vs.length });
      if (vs.length) {
        pattern = path.replace(encodeURIComponent(str(p0.productCode ?? p0.code ?? p0.product_code)), "{code}").replace(encodeURIComponent(str(p0.id)), "{id}");
        break;
      }
    }
  }

  // 3) Không dò ra → trả cấp sản phẩm như cũ, kèm danh sách URL đã thử để còn biết đường sửa.
  if (!pattern) {
    const rows = products.flatMap((p) => rowsFromProduct(p, []));
    return { rows, sample: products[0] ?? first.json, count: products.length, probes, detailPattern: null, detailed: 0 };
  }

  // 4) Gọi chi tiết cho toàn bộ sản phẩm, 8 request song song, dừng khi hết thời gian.
  const rows: HogotoRow[] = [];
  let detailed = 0;
  const CONC = 8;
  for (let i = 0; i < products.length; i += CONC) {
    if (timeLeft() < 5000) {
      for (const p of products.slice(i)) rows.push(...rowsFromProduct(p, []));
      break;
    }
    const chunk = products.slice(i, i + CONC);
    const got = await Promise.all(chunk.map(async (p) => {
      const path = pattern!
        .replace("{code}", encodeURIComponent(str(p.productCode ?? p.code ?? p.product_code)))
        .replace("{id}", encodeURIComponent(str(p.id)));
      try {
        const r = await getJson(apiUrl(cfg.endpoint, path), cfg);
        if (r.status < 200 || r.status >= 300) return { vs: [] as Record<string, unknown>[], img: null as string | null };
        return { vs: deepFindVariations(r.json), img: deepFindImage(r.json) };
      } catch { return { vs: [] as Record<string, unknown>[], img: null as string | null }; }
    }));
    got.forEach((g, k) => { if (g.vs.length) detailed++; rows.push(...rowsFromProduct(chunk[k], g.vs, g.img)); });
  }

  return { rows, sample: products[0] ?? first.json, count: products.length, probes, detailPattern: pattern, detailed };
}
