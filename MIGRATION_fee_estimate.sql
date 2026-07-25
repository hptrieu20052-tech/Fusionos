-- FEE SÀN ƯỚC TÍNH — chạy trên Supabase SQL Editor (an toàn, chỉ THÊM cột, không đụng dữ liệu cũ).
--
-- Bối cảnh: API đơn hàng của Etsy/TikTok KHÔNG trả phí sàn (phí chỉ có khi sàn quyết toán,
-- 7–30 ngày sau). Vì vậy hệ thống ước tính phí theo % cấu hình ở từng Store.
--
-- stores.fee_rate      : % phí sàn ước tính (mặc định 6.5 cho cả Etsy & TikTok)
-- orders.fee_estimated : true = phí đang là số ƯỚC TÍNH (UI hiện "Fee (est.)")
--                        false = phí THẬT (import file Payments của Etsy, hoặc nhập tay)

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS fee_rate numeric(6,3) NOT NULL DEFAULT 6.5;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fee_estimated boolean NOT NULL DEFAULT false;

-- Đơn CŨ đang có phí thật (> 0) → đánh dấu KHÔNG phải ước tính, giữ nguyên số.
UPDATE orders SET fee_estimated = false WHERE platform_fee > 0;

-- Backfill đơn cũ đang FEE = 0 theo 6.5%: KHÔNG chạy ở đây.
-- Vào Stores → mở từng shop → bấm "Backfill estimated fee" để chạy có kiểm soát từng shop.
