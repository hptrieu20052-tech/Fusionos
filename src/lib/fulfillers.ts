import { toISO2, uploadImageByUrl, createProduct, createOrderFromProducts, getPrintAreas } from "@/lib/printify";
import { createMerchizeOrder, pushMerchizeOrder } from "@/lib/merchize";
import { createPrintwayOrder, listPrintwayOrders, normalizePwOrder, calcPrintwayPrice, type PwOrderItem } from "@/lib/printway-api";
import { createFlashshipOrder, type FsProduct } from "@/lib/flashship";
/**
 * KHUNG ADAPTER ĐẨY ĐƠN THEO TỪNG NHÀ FULFILL
 * ------------------------------------------------------------------
 * Mỗi nhà (Printify, Merchize, Printway, Wembroidery, Flashship,
 * Onospod, Compassup, Gearment...) có một adapter riêng với hàm push().
 *
 * Hiện tại tất cả đang ở chế độ SIMULATE (chưa có doc API) — hành vi
 * giống hệt trước: sinh mã đơn giả, ghi sổ đầy đủ.
 *
 * KHI CÓ DOC API TỪNG BÊN: chỉ cần điền phần build request + gọi fetch
 * + đọc id đơn từ response vào đúng hàm push() của bên đó. Không phải
 * đụng tới route push chính.
 */

export type PushLine = {
  fulfillerSku: string; qty: number;
  internalSku?: string | null; productId?: string | null;
  price?: number; currency?: string;
  image?: string | null;
  designFront?: string | null; designBack?: string | null; designSleeve?: string | null; designHood?: string | null;
  designFrontW?: number; designFrontH?: number; designBackW?: number; designBackH?: number;
  pfBlueprintId?: number | null; pfProviderId?: number | null; pfVariantId?: number | null;
};
export type PushCtx = {
  fulfiller: { id: string; name: string; apiEndpoint: string | null; credentials: unknown };
  order: {
    externalId: string; orderLabel?: string | null;
    buyerFirst: string | null; buyerLast: string | null;
    addr1: string | null; addr2: string | null; city: string | null;
    state: string | null; zip: string | null; country: string | null;
    phone?: string | null; email?: string | null;
  };
  lines: PushLine[];
};
export type PushResult = { externalFfId: string; simulated: boolean; raw?: unknown; reason?: string; baseCost?: number; shipCost?: number; tax?: number };
export type FulfillerAdapter = {
  slug: string;
  label: string;
  /** Đẩy đơn sang nhà fulfill. Trả về id đơn bên nhà fulfill. */
  push: (ctx: PushCtx) => Promise<PushResult>;
};

/** Số đơn gửi nhà in = TênStore-IDĐơn (orderLabel) nếu có, else ID đơn. Dùng cho MỌI nhà in. */
export const orderExtNumber = (o: { orderLabel?: string | null; externalId: string }) =>
  (o.orderLabel && o.orderLabel.trim()) ? o.orderLabel.trim() : o.externalId;

/** Sinh mã simulate — dùng chung khi chưa có credentials / chưa ráp API thật. */
const simulate = (slug: string): PushResult => ({
  externalFfId: `SIM-${slug.toUpperCase()}-${Date.now()}`,
  simulated: true,
});

/**
 * Helper để tạo adapter. Khi có doc, thay phần thân `impl` bằng logic gọi API thật:
 *   const res = await fetch(ctx.fulfiller.apiEndpoint + "/orders", {...});
 *   const data = await res.json();
 *   return { externalFfId: data.id, simulated: false, raw: data };
 */
function makeAdapter(slug: string, label: string): FulfillerAdapter {
  return {
    slug,
    label,
    async push(ctx) {
      const hasCreds = !!(ctx.fulfiller.credentials && ctx.fulfiller.apiEndpoint);
      // TODO(doc): khi có tài liệu API của ${label}, build request thật ở đây.
      // Hiện chưa ráp → simulate để đơn vẫn ghi sổ được, không chặn luồng.
      if (!hasCreds) return simulate(slug);
      // Có credentials nhưng chưa cài API thật cho bên này → vẫn simulate,
      // đánh dấu để biết là "chờ ráp".
      return simulate(slug);
    },
  };
}

/** Danh sách nhà fulfill hỗ trợ (slug ⇄ nhãn hiển thị). */
export const FULFILLER_ADAPTERS: Record<string, FulfillerAdapter> = {
  printify: printifyAdapter(),
  merchize: merchizeAdapter(),
  printway: printwayAdapter(),
  wembroidery: makeAdapter("wembroidery", "Wembroidery"),
  flashship: flashshipAdapter(),
  onospod: makeAdapter("onospod", "Onospod"),
  compassup: makeAdapter("compassup", "Compassup"),
  gearment: makeAdapter("gearment", "Gearment"),
};


/**
 * Adapter FlashShip THẬT — POST /orders/shirt-add (seller-api-v2).
 * credentials = { apiKey: <API token 1 năm từ web FlashShip> }; tuỳ chọn { printType: 1|2, shipment: 1|2|3|4|6 }.
 * lines[].fulfillerSku = variant_id FlashShip (số — kéo từ nút Update SKU).
 * FLS-406 (hết balance) → đơn VẪN TẠO, payment PENDING → ghi reason nhắc trả tiền trên FlashShip admin.
 */
function flashshipAdapter(): FulfillerAdapter {
  return {
    slug: "flashship",
    label: "Flashship",
    async push(ctx) {
      const cred = (ctx.fulfiller.credentials ?? {}) as Record<string, string>;
      const accessToken = cred.apiKey || cred.accessToken || cred.apiToken || "";
      if (!accessToken) return { ...simulate("flashship"), reason: "FlashShip chưa có API token (Settings → API Key) → đơn KHÔNG lên nhà in" };

      const o = ctx.order;
      const printType = (Number(cred.printType) === 2 ? 2 : 1) as 1 | 2;
      const shipment = [1, 2, 3, 4, 6].includes(Number(cred.shipment)) ? Number(cred.shipment) : 1;

      const products: FsProduct[] = ctx.lines.map((l) => {
        const p: FsProduct = { variant_id: Number(l.fulfillerSku) || 0, quantity: l.qty, printType };
        if (l.designFront) p.printer_design_front_url = l.designFront;
        if (l.designBack) p.printer_design_back_url = l.designBack;
        if (l.designHood) p.printer_design_hood_url = l.designHood;
        if (l.designSleeve) { p.printer_design_left_url = l.designSleeve; p.printer_design_right_url = l.designSleeve; }
        if (l.image) p.mockup_front_url = l.image;
        return p;
      });
      const bad = products.find((p) => !p.variant_id);
      if (bad) throw new Error("FlashShip cần variant_id dạng SỐ trong SKU mapping (kéo bằng nút Update SKU ở tab Flashship)");

      const res = await createFlashshipOrder({ accessToken, endpoint: ctx.fulfiller.apiEndpoint }, {
        order_id: orderExtNumber(o),
        buyer_first_name: (o.buyerFirst || "").trim() || "Customer",
        buyer_last_name: (o.buyerLast || "").trim() || undefined,
        buyer_email: o.email || undefined,
        buyer_phone: o.phone || undefined,
        buyer_address1: o.addr1 || "",
        buyer_address2: o.addr2 || undefined,
        buyer_city: o.city || "",
        buyer_province_code: usStateAbbr(o.state || ""),
        buyer_zip: o.zip || "",
        buyer_country_code: toISO2(o.country || "United States"),
        shipment,
        products,
      });
      return {
        externalFfId: res.orderCode, simulated: false, raw: res.raw,
        reason: res.paymentPending ? "FLS-406: insufficient balance → payment PENDING, repay on FlashShip web admin" : undefined,
      };
    },
  };
}

// FlashShip yêu cầu mã bang US viết tắt (IN, CA...). Nhận cả tên đầy đủ lẫn mã sẵn.
const US_STATES: Record<string, string> = {
  "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO",
  "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
  "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",
  "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
  "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
  "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
  "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY", "district of columbia": "DC", "puerto rico": "PR",
};
export function usStateAbbr(state: string): string {
  const s = state.trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return US_STATES[s.toLowerCase()] ?? s;
}

/**
 * Adapter Printway THẬT — POST /order/create-new-order (Open API v3).
 * credentials = { apiKey: <pw access token> } (dán Access Token vào ô API Key ở Settings).
 * lines[].fulfillerSku = item_sku bên Printway (vd "PW-2LMORM-3.54X3.54 INCHES-ONE SIDE").
 * Thiếu token → simulate (không chặn luồng).
 */
function printwayAdapter(): FulfillerAdapter {
  return {
    slug: "printway",
    label: "Printway",
    async push(ctx) {
      const cred = (ctx.fulfiller.credentials ?? {}) as Record<string, string>;
      const accessToken = cred.apiKey || cred.accessToken || cred.apiToken || "";
      if (!accessToken) return { ...simulate("printway"), reason: "Printway chưa có Access Token (Settings → API Key) → đơn KHÔNG lên nhà in" };

      const o = ctx.order;
      const first = (o.buyerFirst || "").trim() || "Customer";
      const last = (o.buyerLast || "").trim() || first;
      const state = (o.state || "").trim();

      const items: PwOrderItem[] = ctx.lines.map((l) => {
        const it: PwOrderItem = { item_sku: l.fulfillerSku, quantity: l.qty };
        if (l.image) it.mockup_url = l.image;
        if (l.designFront) it.artwork_front = l.designFront;
        if (l.designBack) it.artwork_back = l.designBack;
        if (l.designHood) it.artwork_hood = l.designHood;
        if (l.designSleeve) { it.artwork_right_upper_sleeves = l.designSleeve; it.artwork_left_upper_sleeves = l.designSleeve; }
        return it;
      });

      // CHỐNG TRÙNG: lần đẩy trước có thể đã tạo đơn bên Printway nhưng FUSION không nhận được
      // response (timeout) → check theo order_name trước, có rồi thì DÙNG LẠI thay vì tạo double.
      try {
        const found = await listPrintwayOrders({ accessToken, endpoint: ctx.fulfiller.apiEndpoint }, { orderName: orderExtNumber(o), limit: 5 });
        const hit = found.items.map((x) => normalizePwOrder(x)).find((x) => x.orderName === orderExtNumber(o) || x.pwId);
        if (hit && (hit.orderName === orderExtNumber(o))) {
          return { externalFfId: hit.pwId || hit.orderName, simulated: false, raw: found.raw, reason: "Order already existed on Printway (from a previous timed-out push) — reused, no duplicate created" };
        }
      } catch { /* check fail → cứ tạo bình thường */ }

      const res = await createPrintwayOrder({ accessToken, endpoint: ctx.fulfiller.apiEndpoint }, {
        order_id: orderExtNumber(o),
        tiktok_order_type: "seller",
        firstName: first,
        lastName: last,
        shipping_email: o.email || undefined,
        shipping_phone: o.phone || undefined,
        shipping_address1: o.addr1 || "",
        shipping_address2: o.addr2 || undefined,
        shipping_city: o.city || "",
        shipping_province: state,
        shipping_province_code: state,
        shipping_zip: o.zip || "",
        shipping_country: o.country || "United States",
        shipping_country_code: toISO2(o.country || "United States"),
        order_items: items,
      });

      // Giá THẬT từ calculate-price (mapping Printway không có giá) — fail thì giữ giá mapping
      let realBase: number | undefined, realShip: number | undefined;
      try {
        const price = await calcPrintwayPrice({ accessToken, endpoint: ctx.fulfiller.apiEndpoint }, {
          countryCode: toISO2(o.country || "United States"),
          provinceCode: usStateAbbr(state),
          items: items.map((i) => ({ item_sku: i.item_sku, variant_id: i.variant_id, quantity: i.quantity })),
        });
        if (price.total > 0) { realBase = price.base || price.total - price.ship; realShip = price.ship; }
      } catch { /* không chặn đẩy đơn */ }

      // KHÔNG auto-pay: đơn tạo xong nằm ở trạng thái unpaid trên Printway —
      // người dùng kiểm tra rồi tự thanh toán bên đó, webhook/poll sẽ kéo trạng thái về.
      return { externalFfId: res.orderId, simulated: false, raw: res.raw, baseCost: realBase, shipCost: realShip };
    },
  };
}

/**
 * Adapter Printify THẬT — gọi API tạo đơn.
 * credentials = { apiKey: <Personal Access Token>, shopId: <shop_id> }
 * lines[].fulfillerSku = SKU của variant sản phẩm bên Printify.
 * Chưa cấu hình token/shopId → simulate (không chặn luồng).
 */
function printifyAdapter(): FulfillerAdapter {
  return {
    slug: "printify",
    label: "Printify",
    async push(ctx) {
      const c = (ctx.fulfiller.credentials ?? {}) as { apiKey?: string; apiToken?: string; shopId?: string | number };
      const token = c.apiKey || c.apiToken;
      const shopId = c.shopId;
      if (!token || !shopId) return simulate("printify"); // chưa cấu hình → simulate

      const o = ctx.order;
      const address = {
        first_name: o.buyerFirst || "Customer", last_name: o.buyerLast || ".",
        email: o.email || undefined, phone: o.phone || undefined,
        country: toISO2(o.country), region: o.state || "",
        address1: o.addr1 || "", address2: o.addr2 || undefined,
        city: o.city || "", zip: o.zip || "",
      };

      // Mỗi line phải có recipe (blueprint/provider/variant). Upload design → tạo product → gom line_item.
      const missing = ctx.lines.filter((l) => !l.pfBlueprintId || !l.pfProviderId || !l.pfVariantId);
      if (missing.length) {
        throw new Error(`Chưa cấu hình Blueprint/Provider/Variant cho SKU: ${missing.map((l) => l.fulfillerSku).join(", ")}. Vào SKU mapping → tab Printify để chọn.`);
      }
      const extNumber = orderExtNumber(o);
      // Lấy kích thước vùng in theo (blueprint, provider) — cache theo cặp để không gọi trùng
      const paCache = new Map<string, Awaited<ReturnType<typeof getPrintAreas>>>();
      const printAreasOf = async (bp: number, pv: number) => {
        const key = `${bp}:${pv}`;
        if (!paCache.has(key)) paCache.set(key, await getPrintAreas(token, bp, pv));
        return paCache.get(key)!;
      };
      // Scale để ảnh KHỚP CHIỀU CAO vùng in (căn trên–dưới). Không có số liệu → 1 (khớp bề ngang như cũ).
      const fitHeightScale = (pa: { width: number; height: number } | undefined, imgW?: number, imgH?: number) => {
        if (!pa || !imgW || !imgH) return 1;
        const s = (pa.height * imgW) / (pa.width * imgH);
        return Math.max(0.1, Math.min(s, 1));
      };
      // Parallel: mỗi line upload ảnh (front+back song song) → tạo product. Các line chạy đồng thời.
      const lineItems = await Promise.all(ctx.lines.map(async (l) => {
        const [frontImageId, backImageId, pa] = await Promise.all([
          l.designFront ? uploadImageByUrl(token, `${l.fulfillerSku}-front`, l.designFront) : Promise.resolve(undefined),
          l.designBack ? uploadImageByUrl(token, `${l.fulfillerSku}-back`, l.designBack) : Promise.resolve(undefined),
          printAreasOf(l.pfBlueprintId!, l.pfProviderId!),
        ]);
        const ph = pa.get(l.pfVariantId!) ?? {};
        const positions = Object.keys(ph);
        // SP 1 mặt in → Front vào vùng in DUY NHẤT (dù tên không phải "front", vd phone case = mặt lưng)
        const frontPos = ph["front"] ? "front" : (positions.length === 1 ? positions[0] : "front");
        const backPos = ph["back"] ? "back" : "back";
        const prod = await createProduct(token, shopId, {
          title: `${extNumber} · ${l.fulfillerSku}`,
          blueprintId: l.pfBlueprintId!, providerId: l.pfProviderId!, variantId: l.pfVariantId!,
          price: l.price ? Math.round(l.price * 100) : 2000,
          frontImageId, backImageId,
          frontScale: fitHeightScale(ph[frontPos], l.designFrontW, l.designFrontH),
          backScale: fitHeightScale(ph[backPos], l.designBackW, l.designBackH),
          frontPosition: frontPos, backPosition: backPos,
        });
        return { product_id: prod.productId, variant_id: prod.variantId, quantity: l.qty };
      }));
      const res = await createOrderFromProducts(token, shopId, extNumber, lineItems, address);
      // Không fetch chi phí ở đây (chậm) — base/ship/tax + tracking sẽ về tự động qua webhook Printify.
      return { externalFfId: res.orderId, simulated: false, raw: res.raw };
    },
  };
}

/**
 * Adapter Merchize THẬT — POST /order/external/orders/catalog (x-api-key).
 * credentials = { apiKey, identifier }, base URL = fulfiller.apiEndpoint.
 * lines mang theo merchize_sku (fulfillerSku), product_id, giá, và URL design (front/back...).
 */
function merchizeAdapter(): FulfillerAdapter {
  return {
    slug: "merchize",
    label: "Merchize",
    async push(ctx) {
      const c = (ctx.fulfiller.credentials ?? {}) as { apiKey?: string; apiToken?: string; identifier?: string };
      const apiKey = c.apiKey || c.apiToken;
      const baseUrl = ctx.fulfiller.apiEndpoint;
      const identifier = c.identifier;
      if (!apiKey || !baseUrl || !identifier) {
        const missing = [!baseUrl && "Base URL", !apiKey && "API Key", !identifier && "Identifier"].filter(Boolean).join(", ");
        return { ...simulate("merchize"), reason: `Chưa cấu hình đủ Merchize (thiếu: ${missing}) → đơn KHÔNG lên nhà in` };
      }

      const o = ctx.order;
      const extNumber = (o.orderLabel && o.orderLabel.trim()) ? o.orderLabel.trim() : o.externalId; // TênStore-IDĐơn
      const res = await createMerchizeOrder(baseUrl, apiKey, {
        order_id: extNumber,
        identifier,
        shipping_info: {
          full_name: [o.buyerFirst, o.buyerLast].filter(Boolean).join(" ") || "Customer",
          address_1: o.addr1 || "",
          address_2: o.addr2 || "",
          city: o.city || "",
          state: o.state || "",
          postcode: o.zip || "",
          country: toISO2(o.country),
          email: o.email || undefined,
          phone: o.phone || undefined,
        },
        items: ctx.lines.map((l) => {
          const url = (u?: string | null) => (typeof u === "string" && /^https?:\/\//i.test(u.trim())) ? u.trim() : undefined;
          return {
            product_id: l.productId || undefined,
            sku: l.internalSku || undefined,
            merchize_sku: l.fulfillerSku,
            quantity: l.qty,
            price: l.price,
            currency: l.currency || "USD",
            image: url(l.image),
            design_front: url(l.designFront),
            design_back: url(l.designBack),
            design_sleeve: url(l.designSleeve),
            design_hood: url(l.designHood),
          };
        }),
      });
      // Bước 2: push (confirm) đơn đi sản xuất
      if (res.orderCode) {
        try { await pushMerchizeOrder(baseUrl, apiKey, { code: res.orderCode, external_number: extNumber, identifier }); }
        catch (e) { throw new Error(`Đã tạo đơn ${res.orderCode} nhưng push (confirm) lỗi: ${String((e as Error)?.message ?? e)}`); }
      }
      return { externalFfId: res.orderCode, simulated: false, raw: res.raw };
    },
  };
}

/** Chuẩn hoá tên nhà fulfill → slug (bỏ dấu, khoảng trắng, ký tự đặc biệt). */
export function slugifyFulfiller(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

/** Lấy adapter theo tên nhà fulfill; không khớp → adapter generic simulate. */
export function getAdapter(name: string): FulfillerAdapter {
  const slug = slugifyFulfiller(name);
  return FULFILLER_ADAPTERS[slug] ?? makeAdapter(slug || "generic", name);
}
