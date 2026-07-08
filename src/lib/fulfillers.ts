import { toISO2, uploadImageByUrl, createProduct, createOrderFromProducts } from "@/lib/printify";
import { createMerchizeOrder, pushMerchizeOrder } from "@/lib/merchize";
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
export type PushResult = { externalFfId: string; simulated: boolean; raw?: unknown; reason?: string };
export type FulfillerAdapter = {
  slug: string;
  label: string;
  /** Đẩy đơn sang nhà fulfill. Trả về id đơn bên nhà fulfill. */
  push: (ctx: PushCtx) => Promise<PushResult>;
};

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
  printway: makeAdapter("printway", "Printway"),
  wembroidery: makeAdapter("wembroidery", "Wembroidery"),
  flashship: makeAdapter("flashship", "Flashship"),
  onospod: makeAdapter("onospod", "Onospod"),
  compassup: makeAdapter("compassup", "Compassup"),
  gearment: makeAdapter("gearment", "Gearment"),
};

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
      const lineItems: { product_id: string; variant_id: number; quantity: number }[] = [];
      for (const l of ctx.lines) {
        const frontImageId = l.designFront ? await uploadImageByUrl(token, `${l.fulfillerSku}-front`, l.designFront) : undefined;
        const backImageId = l.designBack ? await uploadImageByUrl(token, `${l.fulfillerSku}-back`, l.designBack) : undefined;
        const prod = await createProduct(token, shopId, {
          title: `${o.externalId} · ${l.fulfillerSku}`,
          blueprintId: l.pfBlueprintId!, providerId: l.pfProviderId!, variantId: l.pfVariantId!,
          price: l.price ? Math.round(l.price * 100) : 2000,
          frontImageId, backImageId,
        });
        lineItems.push({ product_id: prod.productId, variant_id: prod.variantId, quantity: l.qty });
      }
      const res = await createOrderFromProducts(token, shopId, o.externalId, lineItems, address);
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
