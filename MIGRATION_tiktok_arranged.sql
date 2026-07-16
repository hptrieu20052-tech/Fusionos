-- Khoá chống Arrange (Create Package) 2 lần cho 1 đơn TikTok-shipping (tránh mua nhãn trùng = tốn tiền).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tiktok_arranged_at timestamptz;
