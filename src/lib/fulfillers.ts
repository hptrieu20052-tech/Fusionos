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

export type PushLine = { fulfillerSku: string; qty: number };
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
export type PushResult = { externalFfId: string; simulated: boolean; raw?: unknown };
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
  printify: makeAdapter("printify", "Printify"),
  merchize: makeAdapter("merchize", "Merchize"),
  printway: makeAdapter("printway", "Printway"),
  wembroidery: makeAdapter("wembroidery", "Wembroidery"),
  flashship: makeAdapter("flashship", "Flashship"),
  onospod: makeAdapter("onospod", "Onospod"),
  compassup: makeAdapter("compassup", "Compassup"),
  gearment: makeAdapter("gearment", "Gearment"),
};

/** Chuẩn hoá tên nhà fulfill → slug (bỏ dấu, khoảng trắng, ký tự đặc biệt). */
export function slugifyFulfiller(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

/** Lấy adapter theo tên nhà fulfill; không khớp → adapter generic simulate. */
export function getAdapter(name: string): FulfillerAdapter {
  const slug = slugifyFulfiller(name);
  return FULFILLER_ADAPTERS[slug] ?? makeAdapter(slug || "generic", name);
}
