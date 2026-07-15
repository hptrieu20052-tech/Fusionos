-- Đánh dấu đơn Seller Shipping đã đẩy tracking lên TikTok (ship package). null = chưa đẩy.
ALTER TABLE fulfillment_orders ADD COLUMN IF NOT EXISTS tiktok_tracking_pushed_at timestamptz;
