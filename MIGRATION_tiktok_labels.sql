-- Lưu label TikTok Shipping đã lấy về (đã đẩy R2) trên đơn.
-- [{ packageId, trackingNumber, key, url, fetchedAt }]
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tiktok_labels jsonb;
