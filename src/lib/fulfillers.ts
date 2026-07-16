import { toISO2, uploadImageByUrl, createProduct, createOrderFromProducts, getPrintAreas } from "@/lib/printify";
import { createCompassupOrder, type CompassupCred, type CompassupItem } from "@/lib/compassup";
import { createMerchizeOrder, pushMerchizeOrder } from "@/lib/merchize";
import { createPrintwayOrder, listPrintwayOrders, normalizePwOrder, calcPrintwayPrice, type PwOrderItem } from "@/lib/printway-api";
import { createFlashshipOrder, type FsProduct } from "@/lib/flashship";
import { createOnosOrder, type OnosItem } from "@/lib/onos";
import { createWembroideryOrder, type WemItem, type WemDesign } from "@/lib/wembroidery";
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
  /** Nhãn variant từ mapping (vd "Black / L") — ONOS cần Color+Size, Wembroidery cần size+color */
  variant?: string | null;
  /** Tên sản phẩm bên nhà fulfill (fulfiller_product) — ONOS cần attribute "product" */
  fulfillerProduct?: string | null;
  /** ID sản phẩm bên nhà fulfill (Compassup product_id) */
  fulfillerProductId?: string | null;
  price?: number; currency?: string;
  image?: string | null;
  designFront?: string | null; designBack?: string | null; designSleeve?: string | null; designHood?: string | null;
  designFrontW?: number; designFrontH?: number; designBackW?: number; designBackH?: number;
  /** TẤT CẢ mặt design của card (design_front, book_cover, page_01.., month_01.., grid_01..) — Printify map theo tên vùng in thật */
  designSides?: { kind: string; url: string; w?: number; h?: number }[];
  pfBlueprintId?: number | null; pfProviderId?: number | null; pfVariantId?: number | null;
  /** Dữ liệu riêng của nhà in (Compassup: {link, sup_site, seller_id, weight, sku_id, custom, attachments}) */
  extra?: Record<string, unknown> | null;
};
export type PushCtx = {
  fulfiller: { id: string; name: string; apiEndpoint: string | null; credentials: unknown };
  order: {
    externalId: string; orderLabel?: string | null;
    buyerFirst: string | null; buyerLast: string | null;
    addr1: string | null; addr2: string | null; city: string | null;
    state: string | null; zip: string | null; country: string | null;
    phone?: string | null; email?: string | null;
    /** CHỈ đơn Ship-by-TikTok: link nhãn TikTok (R2) + tracking → gửi supplier. Đơn khác luôn undefined. */
    labelUrl?: string | null; shippingTracking?: string | null;
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
  wembroidery: wembroideryAdapter(),
  flashship: flashshipAdapter(),
  onospod: onosAdapter(),
  onos: onosAdapter(),
  compassup: compassupAdapter(),
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
      if (!accessToken) return { ...simulate("flashship"), reason: "FlashShip API token missing (Settings → API Key) → order NOT sent to the printer" };

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
      if (bad) throw new Error("FlashShip needs a NUMERIC variant_id in SKU mapping (pull via Update SKU on the Flashship tab)");

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
        link_label: o.labelUrl || undefined, // CHỈ đơn Ship-by-TikTok có; đơn khác undefined → không đổi hành vi
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

// Printway BẮT BUỘC email hợp lệ (dù doc ghi optional). Etsy không cho email người mua
// → thiếu thì dùng hộp thư chung của FUSION (chỉ để nhà in liên hệ khi cần).
function pushEmail(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return v;
  return "orders@fusiondn.com";
}

// Printway BẮT BUỘC phone 8–15 chữ số (dù doc ghi optional). Etsy không cho SĐT người mua
// → sanitize về chỉ-chữ-số; thiếu/không hợp lệ thì dùng placeholder 10 số (thực tế POD phổ biến).
function pushPhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 15) return digits;
  return "0000000000";
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
      // response. LƯU Ý: /transaction/order-list chỉ chứa đơn ĐÃ THANH TOÁN nên không dùng
      // pre-check được → bắt thẳng lỗi "has been existed" của create và coi là thành công.
      let res: Awaited<ReturnType<typeof createPrintwayOrder>>;
      try {
        res = await createPrintwayOrder({ accessToken, endpoint: ctx.fulfiller.apiEndpoint }, {
        order_id: orderExtNumber(o),
        // KHÔNG gửi tiktok_order_type: Printway coi field này = đơn TikTok (chỉ ship US),
        // đơn Etsy quốc tế sẽ bị chặn "Tiktok orders are currently available only for the US"
        firstName: first,
        lastName: last,
        shipping_email: pushEmail(o.email),
        shipping_phone: pushPhone(o.phone),
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
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (/has been existed|already exist/i.test(msg)) {
          // Đơn đã có bên Printway (từ lần đẩy timeout trước) → link vào đơn cũ, KHÔNG double.
          // externalFfId = order_id mình gửi; webhook/poll dual-match theo order_name nên vẫn sync đủ.
          res = { orderId: orderExtNumber(o), raw: { reused: true, message: msg } };
        } else throw e;
      }

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
      const reused = !!(res.raw as Record<string, unknown>)?.reused;
      return {
        externalFfId: res.orderId, simulated: false, raw: res.raw,
        baseCost: realBase, shipCost: realShip,
        reason: reused ? "Order already existed on Printway (from a previous failed push) — linked to it, no duplicate created" : undefined,
      };
    },
  };
}

/**
 * Adapter Printify THẬT — gọi API tạo đơn.
 * credentials = { apiKey: <Personal Access Token>, shopId: <shop_id> }
 * lines[].fulfillerSku = SKU của variant sản phẩm bên Printify.
 * Chưa cấu hình token/shopId → simulate (không chặn luồng).
 */
// Chạy fn theo lô, tối đa `limit` cái đồng thời (tránh Printify bóp khi upload nhiều mặt cùng lúc).
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); }
  });
  await Promise.all(workers);
  return out;
}

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
      // Với 1 vùng in (position) của blueprint, tìm mặt design phù hợp trong card.
      // Blueprint đặt tên vùng in rất khác nhau: front / front_side / default / back /
      // cover / page 1 / page_01 / inside_1 ... → match theo SỐ trước, rồi tới TỪ KHOÁ.
      const pad2 = (n: number) => String(n).padStart(2, "0");
      const kindsForPosition = (pos: string): string[] => {
        const p = pos.toLowerCase();
        const out: string[] = [];
        const n = Number(p.match(/(\d+)/)?.[1] ?? 0);
        if (n >= 1 && n <= 24) {
          if (p.includes("month") || p.includes("cal")) out.push(`month_${pad2(n)}`, `grid_${pad2(n)}`, `page_${pad2(n)}`);
          else if (p.includes("grid")) out.push(`grid_${pad2(n)}`, `month_${pad2(n)}`);
          else out.push(`page_${pad2(n)}`, `month_${pad2(n)}`, `grid_${pad2(n)}`);
        }
        if (p.includes("sleeve") && p.includes("left")) out.push("sleeve_left");
        if (p.includes("sleeve") && p.includes("right")) out.push("sleeve_right");
        if (p.includes("back")) out.push("design_back", "back_cover");
        if (p.includes("cover")) out.push("book_cover", "cover_front", "design_front");
        if (p.includes("front") || p.includes("default") || p.includes("all")) out.push("design_front", "cover_front", "book_cover");
        return out;
      };
      // Parallel: mỗi line map mặt design → vùng in → upload đúng ảnh cần → tạo product.
      const lineItems = await Promise.all(ctx.lines.map(async (l) => {
        const pa = await printAreasOf(l.pfBlueprintId!, l.pfProviderId!);
        // Variant không có trong response (hiếm) → mượn positions của variant bất kỳ cùng blueprint
        const ph = pa.get(l.pfVariantId!) ?? pa.values().next().value ?? {};
        const realPos = Object.keys(ph);
        // API không trả placeholder → giữ tên legacy front/back
        const positions = realPos.length ? realPos : ["front", "back"];

        // Gom mọi mặt design của card (fallback về designFront/designBack kiểu cũ)
        type Side = { kind: string; url: string; w?: number; h?: number };
        const byKind = new Map<string, Side>();
        for (const s of l.designSides ?? []) if (s.url) byKind.set(s.kind, s);
        if (l.designFront && !byKind.has("design_front")) byKind.set("design_front", { kind: "design_front", url: l.designFront, w: l.designFrontW, h: l.designFrontH });
        if (l.designBack && !byKind.has("design_back")) byKind.set("design_back", { kind: "design_back", url: l.designBack, w: l.designBackW, h: l.designBackH });

        // Map vùng in → mặt design (mỗi mặt chỉ dùng 1 lần)
        const plan: { position: string; side: Side }[] = [];
        const used = new Set<string>();
        for (const pos of positions) {
          const k = kindsForPosition(pos).find((x) => byKind.has(x) && !used.has(x));
          if (k) { plan.push({ position: pos, side: byKind.get(k)! }); used.add(k); }
        }
        // Không match được vùng nào (vd Photo Book: card chỉ có book_cover/page_xx nhưng blueprint
        // đặt tên khác) → vẫn phải có ≥1 ảnh, nếu không Printify trả 400 "placeholders is required".
        if (!plan.length) {
          const sides = Array.from(byKind.values());
          const primary = byKind.get("design_front") ?? byKind.get("book_cover") ?? byKind.get("cover_front")
            ?? sides.slice().sort((a, b) => a.kind.localeCompare(b.kind))[0];
          if (!primary) throw new Error(`SKU ${l.fulfillerSku}: card design chưa có file mặt in nào — Printify yêu cầu ít nhất 1 ảnh.`);
          plan.push({ position: positions[0], side: primary });
        }

        const uploaded = await mapLimit(plan, 5, (x) => uploadImageByUrl(token, `${l.fulfillerSku}-${x.side.kind}`, x.side.url));
        const placeholders = plan.map((x, i) => ({
          position: x.position,
          images: [{ id: uploaded[i], x: 0.5, y: 0.5, scale: fitHeightScale(ph[x.position], x.side.w, x.side.h), angle: 0 }],
        }));

        const prod = await createProduct(token, shopId, {
          title: `${extNumber} · ${l.fulfillerSku}`,
          blueprintId: l.pfBlueprintId!, providerId: l.pfProviderId!, variantId: l.pfVariantId!,
          price: l.price ? Math.round(l.price * 100) : 2000,
          placeholders,
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
      // KHÔNG AUTO-PAY (mặc định): bước push = CONFIRM đi sản xuất → Merchize trừ balance ngay.
      // Đơn giờ chỉ TẠO Ở DRAFT — người phụ trách kiểm tra rồi tự confirm trên web Merchize.
      // Muốn khôi phục auto-confirm như cũ: thêm credentials { "autoConfirm": "true" }.
      const autoConfirm = String((c as Record<string, unknown>).autoConfirm ?? "") === "true" || String((c as Record<string, unknown>).autoConfirm ?? "") === "1";
      if (res.orderCode && autoConfirm) {
        try { await pushMerchizeOrder(baseUrl, apiKey, { code: res.orderCode, external_number: extNumber, identifier }); }
        catch (e) { throw new Error(`Đã tạo đơn ${res.orderCode} nhưng push (confirm) lỗi: ${String((e as Error)?.message ?? e)}`); }
      }
      return {
        externalFfId: res.orderCode, simulated: false, raw: res.raw,
        reason: autoConfirm ? undefined : "Created as DRAFT on Merchize — review & confirm (pay) it on Merchize web. Set credentials autoConfirm=true to restore auto-confirm.",
      };
    },
  };
}

// ---- Tách Color / Size từ nhãn variant của mapping (vd "Black / L", "L / Black", "As Design / XL") ----
const SIZE_RX = /^(xs|s|m|l|xl|2xl|3xl|4xl|5xl|xxl|xxxl|xxxxl|xxxxxl|one size|os|\d+(\.\d+)?\s*(x\s*\d+(\.\d+)?)?\s*(inch|inches|in|cm|oz)?)$/i;
export function splitColorSize(variant: string | null | undefined): { color: string; size: string } {
  const parts = (variant ?? "").split("/").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { color: "", size: "" };
  if (parts.length === 1) return SIZE_RX.test(parts[0]) ? { color: "", size: parts[0] } : { color: parts[0], size: "" };
  // 2+ phần: phần khớp regex size là size, còn lại là color (mặc định [color, size])
  const sizeIdx = parts.findIndex((p) => SIZE_RX.test(p));
  if (sizeIdx >= 0) {
    const size = parts[sizeIdx];
    const color = parts.filter((_, i) => i !== sizeIdx).join(" / ");
    return { color, size };
  }
  return { color: parts[0], size: parts[parts.length - 1] };
}

/**
 * Adapter ONOS (OnosPOD) THẬT — POST /order/create (Bearer token).
 * credentials = { apiKey: <token HOẶC "email:password"> }; tuỳ chọn { identifier, shippingMethod, testMode }.
 * lines[].fulfillerSku = SKU variant ONOS; fulfillerProductId = product_id; variant = "Color / Size".
 * (order_id + identifier) là khoá duy nhất phía ONOS → identifier cố định để dedupe hoạt động.
 */
function onosAdapter(): FulfillerAdapter {
  return {
    slug: "onospod",
    label: "Onospod",
    async push(ctx) {
      const cred = (ctx.fulfiller.credentials ?? {}) as Record<string, string>;
      const apiKey = cred.apiKey || cred.accessToken || cred.apiToken || "";
      if (!apiKey) return { ...simulate("onospod"), reason: "ONOS token missing (Settings → API Key: paste token or email:password) → order NOT sent to the printer" };

      const o = ctx.order;
      const url = (u?: string | null) => (typeof u === "string" && /^https?:\/\//i.test(u.trim())) ? u.trim() : undefined;
      const items: OnosItem[] = ctx.lines.map((l) => {
        const { color, size } = splitColorSize(l.variant);
        const it: OnosItem = {
          sku: l.fulfillerSku,
          quantity: l.qty,
          name: l.fulfillerProduct || l.fulfillerSku,
          product_id: l.productId || undefined,
          price: l.price,
          currency: l.currency || "USD",
          image: url(l.image),
          // attributes tối thiểu cần product + Color + Size (docs ONOS)
          attributes: [
            { name: "product", option: l.fulfillerProduct || l.fulfillerSku },
            { name: "Color", option: color || "As Design" },
            { name: "Size", option: size || "One Size" },
          ],
        };
        if (url(l.designFront)) it.design_front = url(l.designFront);
        if (url(l.designBack)) it.design_back = url(l.designBack);
        if (url(l.designHood)) it.design_hood = url(l.designHood);
        return it;
      });

      // Đơn Ship-by-TikTok (có label) → SBTT + tracking.link_print = link nhãn TikTok. Đơn khác giữ nguyên như cũ.
      const isTtLabel = !!o.labelUrl;
      const method = isTtLabel ? "SBTT" as const : (["ONOSEXPRESS", "SBTT", "COD"].includes(cred.shippingMethod) ? cred.shippingMethod as "ONOSEXPRESS" | "SBTT" | "COD" : "ONOSEXPRESS");
      const res = await createOnosOrder({ apiKey, endpoint: ctx.fulfiller.apiEndpoint }, {
        order_id: orderExtNumber(o),
        identifier: cred.identifier || "FUSION",
        reference_id: o.externalId,
        items,
        ...(isTtLabel ? { inc_active_service: true, tracking: { tracking_number: o.shippingTracking || "", carrier: "USPS", link_print: o.labelUrl || undefined } } : {}),
        shipping_info: {
          full_name: [o.buyerFirst, o.buyerLast].filter(Boolean).join(" ") || "Customer",
          address_1: o.addr1 || "",
          address_2: o.addr2 || undefined,
          city: o.city || "",
          state: o.state || "",
          postcode: o.zip || "",
          country: toISO2(o.country || "United States"),
          email: o.email || undefined,
          phone: o.phone || undefined,
        },
        shipping_method: method,
      }, cred.testMode === "true" || cred.testMode === "1");
      return {
        externalFfId: res.onosId, simulated: false, raw: res.raw,
        reason: res.dedup ? "Order already existed on ONOS (from a previous failed push) — linked to it, no duplicate created" : undefined,
      };
    },
  };
}

/**
 * Adapter Wembroidery THẬT — POST /orders (token query param).
 * credentials = { apiKey: <store token> }; tuỳ chọn { shippingMethod ("standard"), ioss }.
 * lines[].fulfillerProductId = catalogId; variant = "Color / Size" (color snake_case theo catalog).
 * Design: imageUrl = ảnh design; nếu URL là file thêu (.emb/.dst/.pes...) thì gửi embUrl.
 */
function wembroideryAdapter(): FulfillerAdapter {
  return {
    slug: "wembroidery",
    label: "Wembroidery",
    async push(ctx) {
      const cred = (ctx.fulfiller.credentials ?? {}) as Record<string, string>;
      const apiKey = cred.apiKey || cred.accessToken || cred.apiToken || "";
      if (!apiKey) return { ...simulate("wembroidery"), reason: "Wembroidery token missing (Settings → API Key: paste store token) → order NOT sent to the printer" };

      const o = ctx.order;
      const url = (u?: string | null) => (typeof u === "string" && /^https?:\/\//i.test(u.trim())) ? u.trim() : undefined;
      const EMB_RX = /\.(emb|dst|pes|exp|jef|vp3|xxx)(\?|#|$)/i;
      const design = (location: string, u?: string | null, mockup?: string | null): WemDesign | null => {
        const link = url(u);
        if (!link) return null;
        const d: WemDesign = { location };
        if (EMB_RX.test(link)) d.embUrl = link; else d.imageUrl = link;
        if (url(mockup)) d.mockup = url(mockup);
        return d;
      };
      // Chuẩn hoá color về snake_case theo catalog Wembroidery (black, sport_grey...)
      const snake = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "_");

      const badLine = ctx.lines.find((l) => !Number(l.productId));
      if (badLine) throw new Error(`Wembroidery needs a numeric catalogId in SKU mapping for "${badLine.fulfillerSku}" (pull via Update SKU on the Wembroidery tab)`);

      // Locations THẬT theo catalog ("front" không tồn tại ở nhiều catalog — T-shirt dùng center_chest...)
      const { resolveWemLocations } = await import("@/lib/wembroidery");
      const wemCred = { apiKey, endpoint: ctx.fulfiller.apiEndpoint };
      const items: WemItem[] = await Promise.all(ctx.lines.map(async (l) => {
        const { color, size } = splitColorSize(l.variant);
        const loc = await resolveWemLocations(wemCred, String(l.productId));
        const designs = [
          design(loc.front, l.designFront, l.image),
          design(loc.back, l.designBack),
        ].filter(Boolean) as WemDesign[];
        if (!designs.length && url(l.image)) designs.push({ location: loc.front, imageUrl: url(l.image)! });
        return {
          catalogId: Number(l.productId),
          designs,
          quantity: l.qty,
          size: size.toLowerCase() || "m",
          color: snake(color) || "black",
        };
      }));

      const res = await createWembroideryOrder({ apiKey, endpoint: ctx.fulfiller.apiEndpoint }, {
        address: {
          firstName: (o.buyerFirst || "").trim() || "Customer",
          lastName: (o.buyerLast || "").trim() || ".",
          address1: o.addr1 || "",
          address2: o.addr2 || undefined,
          city: o.city || "",
          state: usStateAbbr(o.state || ""),
          zip: o.zip || "",
          country: toISO2(o.country || "United States"),
          email: o.email || undefined,
          phone: o.phone || undefined,
        },
        sellerOrderId: orderExtNumber(o),
        shippingMethod: cred.shippingMethod || "standard",
        ioss: cred.ioss || undefined,
        items,
      });
      return {
        externalFfId: res.wemId, simulated: false, raw: res.raw,
        baseCost: res.baseCost, shipCost: res.shipCost,
        reason: res.dedup ? "Order already existed on Wembroidery (from a previous failed push) — linked to it, no duplicate created" : undefined,
      };
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


/**
 * Adapter COMPASSUP THẬT — POST /openapi/1/orders.
 *
 * Nhà SOURCING/DROPSHIP trung gian: sản phẩm từ sup TQ (b2b_cn), Compassup gộp mọi item
 * thành 1 đơn = 1 tracking. KHÔNG phải POD → không design (trừ item custom).
 *
 * credentials = {
 *   bearerToken, tenant, restKey, username,   // auth + ký sign
 *   accountId,                                 // account_id (shop bên Compassup)
 *   warehouseId,                               // warehouse_id (cố định)
 *   goodType?: "normal", transport?: "fast",   // services (mặc định normal/fast)
 *   shippingType?: "seller",                   // seller | platform
 *   shippingFrom?: "CN",
 * }
 * lines[].fulfillerSku      = sku_id Compassup
 * lines[].fulfillerProductId = product_id
 * lines[].extra             = { link, sup_site, seller_id, weight, image_link, declaration_title, custom?, attachments? }
 */
function compassupAdapter(): FulfillerAdapter {
  return {
    slug: "compassup", label: "Compassup",
    async push(ctx) {
      const cr = (ctx.fulfiller.credentials ?? {}) as Record<string, string>;
      const token = cr.bearerToken || cr.apiKey || cr.accessToken;
      if (!token || !cr.tenant || !cr.restKey || !ctx.fulfiller.apiEndpoint) return simulate("compassup");

      const cred: CompassupCred = {
        bearerToken: token, tenant: cr.tenant, restKey: cr.restKey,
        endpoint: ctx.fulfiller.apiEndpoint, username: cr.username || cr.tenant,
      };
      const o = ctx.order;
      const num = orderExtNumber(o);

      const items: CompassupItem[] = ctx.lines.map((l) => {
        const ex = (l.extra ?? {}) as Record<string, unknown>;
        const weightEach = Number(ex.weight ?? 0) || 0.1; // fallback 0.1kg nếu SP không có weight
        // Có design gán vào (designSides) = coi như custom → đính link file design cho nhà in.
        const isCustom = ex.custom === true || (Array.isArray(ex.attachments) && (ex.attachments as unknown[]).length > 0) || (l.designSides?.length ?? 0) > 0;
        const it: CompassupItem = {
          product_id: String(l.fulfillerProductId ?? ex.product_id ?? ""),
          sku_id: l.fulfillerSku,
          product_name: String(ex.product_name ?? l.fulfillerProduct ?? l.internalSku ?? ""),
          declaration_title: String(ex.declaration_title ?? ex.product_name ?? l.fulfillerProduct ?? ""),
          quantity: l.qty,
          weight: Math.round(weightEach * l.qty * 1000) / 1000,
          attribute: String(ex.attribute ?? l.variant ?? ""),
          image_link: String(ex.image_link ?? l.image ?? ""),
          link: String(ex.link ?? ""),
          sup_site: String(ex.sup_site ?? "b2b_cn"),
          seller_id: String(ex.seller_id ?? ""),
          state: String(ex.state ?? "confirmed"),
          warehouse_id: String(ex.warehouse_id ?? cr.warehouseId ?? ""),
        };
        // Đơn CUSTOM: gắn type + attachments (link file design bên mình)
        if (isCustom) {
          it.type = "custom";
          const att = (Array.isArray(ex.attachments) ? ex.attachments : []) as { src: string; type?: string }[];
          it.attachments = att.map((a) => ({ src: String(a.src), type: a.type || "link" }));
          // Nếu chưa cấp attachments nhưng có designSides → dùng chúng
          if (!it.attachments.length && l.designSides?.length) {
            it.attachments = l.designSides.map((d) => ({ src: d.url, type: "link" }));
          }
        }
        return it;
      });

      const totalWeight = Math.round(items.reduce((a, i) => a + i.weight, 0) * 1000) / 1000;

      const res = await createCompassupOrder(cred, {
        platform: (cr.platform || detectPlatform(o.orderLabel) || "etsy"),
        account_id: cr.accountId || cr.account_id || "",
        shipping_country: toISO2(o.country) || "US",
        shipping_from: cr.shippingFrom || "CN",
        shipping_name: [o.buyerFirst, o.buyerLast].filter(Boolean).join(" ") || "Customer",
        shipping_phone: o.phone || "0000000000",
        shipping_address: [o.addr1, o.addr2].filter(Boolean).join(", "),
        shipping_city: o.city || "",
        shipping_state: o.state || "",
        shipping_zipcode: o.zip || "",
        own_code: num,
        items,
        shipping_type: cr.shippingType || "seller",
        weight_before: totalWeight || 0.1,
        services: { good_type: cr.goodType || "normal", transport: cr.transport || "fast" },
        certificate_type: "", certificate_code: "",
      });
      return { externalFfId: res.orderId, simulated: false, raw: res.raw };
    },
  };
}

/** Đoán platform từ orderLabel (STORE-<id>): số đơn TikTok toàn số dài, Etsy có tiền tố cửa hàng. */
function detectPlatform(label?: string | null): string | null {
  if (!label) return null;
  return /tiktok/i.test(label) ? "tiktok" : /etsy/i.test(label) ? "etsy" : null;
}

/**
 * THROTTLE POLL NHÀ IN — mặc định 2 phút (trước là 10 phút → tracking về quá chậm).
 * Chỉnh bằng env FF_POLL_THROTTLE_MS. Đặt 0 = không throttle (chỉ nên dùng khi debug:
 * mỗi nhà in đều có rate limit, vd Printway 50 req/3s).
 */
export const FF_POLL_THROTTLE_MS = Number(process.env.FF_POLL_THROTTLE_MS ?? 2 * 60_000);
