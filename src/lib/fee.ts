import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

/**
 * FEE SÀN — vì sao phải ước tính?
 * API đơn hàng của Etsy (Receipt) và TikTok (Order) KHÔNG kèm phí sàn: sàn chỉ chốt phí
 * khi QUYẾT TOÁN (settlement), tức sau khi giao hàng xong + hết cửa sổ hoàn tiền (7–30 ngày).
 * Vì vậy đơn vừa kéo về luôn có phí = 0 nếu không ước tính → Finance/Profit bị phồng ảo.
 *
 * Giải pháp: mỗi Store có 1 tỉ lệ % (stores.fee_rate, mặc định 6.5%). Đơn mới về tự tính
 * platform_fee = total × %, và đánh dấu orders.fee_estimated = true để UI ghi rõ "Fee (est.)".
 * Khi có số THẬT (import file Payments của Etsy, hoặc nhập tay) thì ghi đè và cờ về false.
 */

export const DEFAULT_FEE_PCT = 6.5;

/** Lấy % phí sàn cấu hình ở Store. Trả 0 nếu không có/không hợp lệ → không ước tính. */
export async function storeFeePct(storeId: string | null | undefined): Promise<number> {
  if (!storeId) return 0;
  try {
    const [st] = await db.select({ r: schema.stores.feeRate }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    return normFeePct(st?.r);
  } catch {
    return 0;
  }
}

/** Chuẩn hoá % phí: chỉ nhận 0 < x < 100. Ngoài khoảng → 0 (tắt ước tính). */
export function normFeePct(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : 0;
}

/** Phí ước tính (USD, chuỗi 2 số lẻ) từ tổng đơn USD + %. */
export function estFee(totalUsd: number, pct: number): string {
  const t = Number(totalUsd);
  if (!Number.isFinite(t) || t <= 0 || pct <= 0) return "0.00";
  return ((t * pct) / 100).toFixed(2);
}
