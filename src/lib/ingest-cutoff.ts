/**
 * MỐC LAUNCH — chống đơn HỆ THỐNG CŨ tràn vào FUSION rồi bị push đúp sang nhà in.
 * Set env INGEST_SINCE=YYYY-MM-DD (giờ UTC, ví dụ 2026-07-14) trên Vercel:
 * mọi kênh kéo/nhập đơn (Etsy cron, TikTok pull, extension, CSV) BỎ QUA đơn đặt TRƯỚC mốc này.
 * Đơn cũ tiếp tục xử lý trọn vẹn ở hệ thống cũ; FUSION chỉ nhận đơn từ ngày launch.
 * Không set env → không cắt (giữ hành vi cũ).
 */
export function ingestSinceMs(): number {
  const v = (process.env.INGEST_SINCE ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 0;
  const t = Date.parse(v + "T00:00:00Z");
  return isNaN(t) ? 0 : t;
}

/** true nếu thời điểm đặt đơn nằm TRƯỚC mốc launch → phải bỏ qua. */
export function beforeLaunch(orderedAt: Date | string | number | null | undefined): boolean {
  const cut = ingestSinceMs();
  if (!cut || orderedAt == null) return false;
  const t = orderedAt instanceof Date ? orderedAt.getTime() : typeof orderedAt === "number" ? (orderedAt < 1e12 ? orderedAt * 1000 : orderedAt) : Date.parse(String(orderedAt));
  return !isNaN(t) && t < cut;
}
