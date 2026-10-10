-- ════════════════════════════════════════════════════════════════════════════
-- v641 · Đẩy tracking NGƯỢC lên WooCommerce (Sorawix) — như Etsy/TikTok/Shopify.
-- Chạy 1 lần trên Supabase SQL Editor TRƯỚC khi deploy v641.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE fulfillment_orders
  ADD COLUMN IF NOT EXISTS woo_tracking_pushed_at timestamptz,
  ADD COLUMN IF NOT EXISTS woo_push_error text,
  ADD COLUMN IF NOT EXISTS woo_push_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS woo_push_next_at timestamptz;
