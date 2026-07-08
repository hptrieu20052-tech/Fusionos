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
