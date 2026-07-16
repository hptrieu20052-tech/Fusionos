/**
 * Printify API client — https://developers.printify.com
 * Base: https://api.printify.com/v1/  ·  Auth: Bearer {token}  ·  User-Agent bắt buộc.
 */
const BASE = "https://api.printify.com/v1";

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json;charset=utf-8",
    "User-Agent": "FusionOS",
  };
}

// Tên nước → ISO2 (Printify yêu cầu mã 2 ký tự). Đã là 2 ký tự thì giữ nguyên.
const ISO2: Record<string, string> = {
  "united states": "US", "usa": "US", "united states of america": "US",
  "canada": "CA", "united kingdom": "GB", "uk": "GB", "great britain": "GB",
  "australia": "AU", "germany": "DE", "france": "FR", "italy": "IT", "spain": "ES",
  "netherlands": "NL", "ireland": "IE", "new zealand": "NZ", "sweden": "SE",
  "norway": "NO", "denmark": "DK", "finland": "FI", "belgium": "BE", "austria": "AT",
  "switzerland": "CH", "portugal": "PT", "poland": "PL", "japan": "JP", "mexico": "MX",
  "brazil": "BR", "vietnam": "VN", "singapore": "SG",
};
export function toISO2(country: string | null): string {
  const c = (country ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(c)) return c.toUpperCase();
  return ISO2[c.toLowerCase()] ?? countryNameToCode()[c.toLowerCase()] ?? c;
}

// Map ngược ĐỦ 249 nước từ Intl.DisplayNames (tên tiếng Anh — Etsy xuất tên tiếng Anh).
// Map tay ISO2 ở trên giữ vai trò alias ("UK", "USA"...). Build 1 lần khi cần.
let COUNTRY_REV: Record<string, string> | null = null;
function countryNameToCode(): Record<string, string> {
  if (COUNTRY_REV) return COUNTRY_REV;
  COUNTRY_REV = {};
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const a of A) for (const b of A) {
      const code = a + b;
      const name = dn.of(code);
      if (name && name !== code) COUNTRY_REV[name.toLowerCase()] = code;
    }
  } catch { /* ICU thiếu → còn map tay */ }
  return COUNTRY_REV;
}

export type PrintifyShop = { id: number; title: string; sales_channel: string };

/** Liệt kê shop trong tài khoản Printify (để lấy shop_id). */
export async function listPrintifyShops(token: string): Promise<PrintifyShop[]> {
  const res = await fetch(`${BASE}/shops.json`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Printify shops HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export type PrintifyAddress = {
  first_name: string; last_name: string; email?: string; phone?: string;
  country: string; region?: string; address1: string; address2?: string; city: string; zip: string;
};
export type PrintifyLine = { sku: string; quantity: number };

/** Tạo đơn trên Printify. line_items theo SKU của variant sản phẩm bên Printify. */
export async function createPrintifyOrder(
  token: string, shopId: string | number,
  payload: { external_id: string; label?: string; line_items: PrintifyLine[]; address_to: PrintifyAddress; shipping_method?: number },
): Promise<{ id: string; raw: unknown }> {
  const body = {
    external_id: payload.external_id,
    label: payload.label ?? payload.external_id,
    line_items: payload.line_items,
    shipping_method: payload.shipping_method ?? 1, // 1 = standard
    send_shipping_notification: false,
    address_to: payload.address_to,
  };
  const res = await fetch(`${BASE}/shops/${shopId}/orders.json`, {
    method: "POST", headers: headers(token), body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Printify order HTTP ${res.status}: ${text.slice(0, 400)}`);
  const data = text ? JSON.parse(text) : {};
  return { id: String(data.id ?? ""), raw: data };
}

/** Lấy chi tiết đơn Printify (gồm shipments/tracking). */
export async function getPrintifyOrder(token: string, shopId: string | number, orderId: string) {
  const res = await fetch(`${BASE}/shops/${shopId}/orders/${orderId}.json`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Printify get order HTTP ${res.status}`);
  return res.json();
}

export type PrintifyVariant = { id: number; sku: string; cost: number; price: number; title: string; is_enabled: boolean };
export type PrintifyProduct = { id: string; title: string; variants: PrintifyVariant[] };

/** Lấy toàn bộ product + variant của shop (phân trang). cost/price ở đơn vị cent. */
export async function listPrintifyProducts(token: string, shopId: string | number): Promise<PrintifyProduct[]> {
  const out: PrintifyProduct[] = [];
  let page = 1;
  for (let i = 0; i < 100; i++) { // trần an toàn 100 trang
    const res = await fetch(`${BASE}/shops/${shopId}/products.json?limit=50&page=${page}`, { headers: headers(token) });
    if (!res.ok) throw new Error(`Printify products HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    const data: PrintifyProduct[] = j.data ?? [];
    out.push(...data);
    if (!j.last_page || page >= j.last_page || data.length === 0) break;
    page++;
  }
  return out;
}

/* ============ CATALOG (chọn blueprint → provider → variant) ============ */

export type Blueprint = { id: number; title: string; brand: string; model: string };
export async function listBlueprints(token: string): Promise<Blueprint[]> {
  const res = await fetch(`${BASE}/catalog/blueprints.json`, { headers: headers(token), cache: "no-store" });
  if (!res.ok) throw new Error(`Printify blueprints HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Blueprint[];
}

export type Provider = { id: number; title: string };
export async function listProviders(token: string, blueprintId: number | string): Promise<Provider[]> {
  const res = await fetch(`${BASE}/catalog/blueprints/${blueprintId}/print_providers.json`, { headers: headers(token), cache: "no-store" });
  if (!res.ok) throw new Error(`Printify providers HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Provider[];
}

export type CatalogVariant = { id: number; title: string; options?: Record<string, string> };
export async function listVariants(token: string, blueprintId: number | string, providerId: number | string): Promise<CatalogVariant[]> {
  const res = await fetch(`${BASE}/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`, { headers: headers(token), cache: "no-store" });
  if (!res.ok) throw new Error(`Printify variants HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { variants?: CatalogVariant[] };
  return j.variants ?? [];
}

/** Kích thước vùng in (px) theo variant + vị trí: Map<variantId, { front|back → {width,height} }>. Để tính scale khớp chiều cao. */
export async function getPrintAreas(token: string, blueprintId: number | string, providerId: number | string): Promise<Map<number, Record<string, { width: number; height: number }>>> {
  const map = new Map<number, Record<string, { width: number; height: number }>>();
  try {
    const res = await fetch(`${BASE}/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`, { headers: headers(token), cache: "no-store" });
    if (!res.ok) return map;
    const j = (await res.json()) as { variants?: { id: number; placeholders?: { position: string; width: number; height: number }[] }[] };
    for (const v of j.variants ?? []) {
      const rec: Record<string, { width: number; height: number }> = {};
      for (const p of v.placeholders ?? []) if (p.position && p.width && p.height) rec[p.position] = { width: p.width, height: p.height };
      map.set(v.id, rec);
    }
  } catch { /* bỏ qua → fallback scale 1 */ }
  return map;
}

/* ============ UPLOAD ẢNH → tạo PRODUCT → tạo ĐƠN ============ */

/** Upload ảnh lên Printify bằng URL. Trả image_id. */
export async function uploadImageByUrl(token: string, fileName: string, url: string): Promise<string> {
  let lastErr: Error | null = null;
  // Thử tối đa 3 lần: ảnh bị Cloudflare bóp/cache lạnh thường lần sau là được.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/uploads/images.json`, {
        method: "POST", headers: headers(token),
        body: JSON.stringify({ file_name: fileName, url }),
        signal: AbortSignal.timeout(60000), // 60s: đủ cho ảnh tải chậm (cache lạnh / origin chậm). Tạo mới mỗi call.
      });
      if (res.ok) { const j = (await res.json()) as { id: string }; return j.id; }
      lastErr = new Error(`Printify upload HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
    } catch (e) {
      lastErr = new Error(`Printify upload timeout/lỗi mạng (${fileName}): ${String((e as Error)?.message ?? e)}`);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt)); // backoff 1.5s, 3s
  }
  throw lastErr ?? new Error(`Printify upload thất bại (${fileName})`);
}

export type PfPlaceholder = { position: string; images: { id: string; x: number; y: number; scale: number; angle: number }[] };
export type CreateProductInput = {
  title: string;
  blueprintId: number; providerId: number; variantId: number;
  price?: number; // cents; mặc định 2000
  /** Cách MỚI: truyền thẳng placeholders đã map (nhiều mặt: cover/page_xx/month_xx...). Ưu tiên hơn front/back. */
  placeholders?: PfPlaceholder[];
  frontImageId?: string; backImageId?: string;
  frontScale?: number; backScale?: number; // scale ảnh (khớp chiều cao vùng in)
  frontPosition?: string; backPosition?: string; // vị trí placeholder (SP 1 mặt → Front vào vùng duy nhất)
};
/** Tạo product trong shop. Trả { productId, variantId }. */
export async function createProduct(token: string, shopId: string | number, inp: CreateProductInput): Promise<{ productId: string; variantId: number }> {
  const placeholders: PfPlaceholder[] = [...(inp.placeholders ?? [])];
  const fPos = inp.frontPosition ?? "front";
  const bPos = inp.backPosition ?? "back";
  if (!placeholders.length) {
    if (inp.frontImageId) placeholders.push({ position: fPos, images: [{ id: inp.frontImageId, x: 0.5, y: 0.5, scale: inp.frontScale ?? 1, angle: 0 }] });
    if (inp.backImageId && bPos !== fPos) placeholders.push({ position: bPos, images: [{ id: inp.backImageId, x: 0.5, y: 0.5, scale: inp.backScale ?? 1, angle: 0 }] });
  }
  // Printify BẮT BUỘC print_areas[].placeholders không rỗng → báo lỗi rõ ràng thay vì HTTP 400 khó hiểu.
  if (!placeholders.length) throw new Error("Design chưa có file mặt in nào để gửi Printify (print_areas.placeholders rỗng).");

  const body = {
    title: inp.title.slice(0, 120) || "Fusion order",
    description: "Created by Fusion OS",
    blueprint_id: inp.blueprintId,
    print_provider_id: inp.providerId,
    variants: [{ id: inp.variantId, price: inp.price ?? 2000, is_enabled: true }],
    print_areas: [{ variant_ids: [inp.variantId], placeholders }],
  };
  let res: Response;
  try {
    res = await fetch(`${BASE}/shops/${shopId}/products.json`, {
      method: "POST", headers: headers(token), body: JSON.stringify(body),
      signal: AbortSignal.timeout(40000),
    });
  } catch (e) {
    throw new Error(`Printify create product timeout/lỗi mạng: ${String((e as Error)?.message ?? e)}`);
  }
  if (!res.ok) throw new Error(`Printify create product HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { id: string; variants: { id: number }[] };
  return { productId: j.id, variantId: inp.variantId };
}

/** Tạo đơn từ product đã tạo. line_items: [{ product_id, variant_id, quantity }]. */
export async function createOrderFromProducts(
  token: string, shopId: string | number,
  externalId: string,
  lineItems: { product_id: string; variant_id: number; quantity: number }[],
  address: {
    first_name: string; last_name: string; email?: string; phone?: string;
    country: string; region?: string; address1: string; address2?: string; city: string; zip: string;
  },
): Promise<{ orderId: string; raw: unknown }> {
  const body = {
    external_id: externalId,
    label: externalId,
    line_items: lineItems,
    shipping_method: 1,
    send_shipping_notification: false,
    address_to: {
      first_name: address.first_name || "Customer", last_name: address.last_name || "",
      email: address.email || "", phone: address.phone || "",
      country: address.country, region: address.region || "",
      address1: address.address1 || "", address2: address.address2 || "",
      city: address.city || "", zip: address.zip || "",
    },
  };
  let res: Response;
  try {
    res = await fetch(`${BASE}/shops/${shopId}/orders.json`, {
      method: "POST", headers: headers(token), body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new Error(`Printify create order timeout/lỗi mạng: ${String((e as Error)?.message ?? e)}`);
  }
  if (!res.ok) throw new Error(`Printify create order HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { id: string };
  return { orderId: j.id, raw: j };
}

/** Liệt kê webhook đang có của shop. */
export async function listWebhooks(token: string, shopId: string | number): Promise<{ id: string; topic: string; url: string }[]> {
  const res = await fetch(`${BASE}/shops/${shopId}/webhooks.json`, { headers: headers(token), cache: "no-store" });
  if (!res.ok) return [];
  const j = await res.json();
  return (Array.isArray(j) ? j : []) as { id: string; topic: string; url: string }[];
}

/** Tạo 1 webhook. */
export async function createWebhook(token: string, shopId: string | number, topic: string, url: string): Promise<boolean> {
  const res = await fetch(`${BASE}/shops/${shopId}/webhooks.json`, {
    method: "POST", headers: headers(token), body: JSON.stringify({ topic, url }),
  });
  return res.ok;
}

/** Đảm bảo đã đăng ký đủ webhook trỏ về `url` (idempotent — không tạo trùng). */
export async function ensureWebhooks(token: string, shopId: string | number, url: string): Promise<{ created: number; existing: number }> {
  const topics = ["order:updated", "order:sent-to-production", "order:shipment:created", "order:shipment:delivered"];
  let existing: { topic: string; url: string }[] = [];
  try { existing = await listWebhooks(token, shopId); } catch { /* bỏ qua */ }
  const have = new Set(existing.filter((w) => w.url === url).map((w) => w.topic));
  let created = 0;
  for (const t of topics) {
    if (have.has(t)) continue;
    try { if (await createWebhook(token, shopId, t, url)) created++; } catch { /* bỏ qua topic lỗi */ }
  }
  return { created, existing: have.size };
}
