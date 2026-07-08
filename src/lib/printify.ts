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
  return ISO2[c.toLowerCase()] ?? c;
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
  const res = await fetch(`${BASE}/catalog/blueprints.json`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Printify blueprints HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Blueprint[];
}

export type Provider = { id: number; title: string };
export async function listProviders(token: string, blueprintId: number | string): Promise<Provider[]> {
  const res = await fetch(`${BASE}/catalog/blueprints/${blueprintId}/print_providers.json`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Printify providers HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Provider[];
}

export type CatalogVariant = { id: number; title: string; options?: Record<string, string> };
export async function listVariants(token: string, blueprintId: number | string, providerId: number | string): Promise<CatalogVariant[]> {
  const res = await fetch(`${BASE}/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Printify variants HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { variants?: CatalogVariant[] };
  return j.variants ?? [];
}

/* ============ UPLOAD ẢNH → tạo PRODUCT → tạo ĐƠN ============ */

/** Upload ảnh lên Printify bằng URL. Trả image_id. */
export async function uploadImageByUrl(token: string, fileName: string, url: string): Promise<string> {
  const res = await fetch(`${BASE}/uploads/images.json`, {
    method: "POST", headers: headers(token),
    body: JSON.stringify({ file_name: fileName, url }),
  });
  if (!res.ok) throw new Error(`Printify upload HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { id: string };
  return j.id;
}

export type CreateProductInput = {
  title: string;
  blueprintId: number; providerId: number; variantId: number;
  price?: number; // cents; mặc định 2000
  frontImageId?: string; backImageId?: string;
};
/** Tạo product trong shop. Trả { productId, variantId }. */
export async function createProduct(token: string, shopId: string | number, inp: CreateProductInput): Promise<{ productId: string; variantId: number }> {
  const placeholders: { position: string; images: { id: string; x: number; y: number; scale: number; angle: number }[] }[] = [];
  if (inp.frontImageId) placeholders.push({ position: "front", images: [{ id: inp.frontImageId, x: 0.5, y: 0.5, scale: 1, angle: 0 }] });
  if (inp.backImageId) placeholders.push({ position: "back", images: [{ id: inp.backImageId, x: 0.5, y: 0.5, scale: 1, angle: 0 }] });

  const body = {
    title: inp.title.slice(0, 120) || "Fusion order",
    description: "Created by Fusion OS",
    blueprint_id: inp.blueprintId,
    print_provider_id: inp.providerId,
    variants: [{ id: inp.variantId, price: inp.price ?? 2000, is_enabled: true }],
    print_areas: [{ variant_ids: [inp.variantId], placeholders }],
  };
  const res = await fetch(`${BASE}/shops/${shopId}/products.json`, {
    method: "POST", headers: headers(token), body: JSON.stringify(body),
  });
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
  const res = await fetch(`${BASE}/shops/${shopId}/orders.json`, {
    method: "POST", headers: headers(token), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Printify create order HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { id: string };
  return { orderId: j.id, raw: j };
}
