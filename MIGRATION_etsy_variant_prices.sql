-- Giá theo size cho Manage Products Etsy (Bulk Price). Chạy trong Supabase SQL Editor.
-- variant_prices: map { "8x8": "39.95", "11x8.5": "49.95" } — export Shopify lấy giá đúng theo size.
ALTER TABLE etsy_products ADD COLUMN IF NOT EXISTS variant_prices jsonb NOT NULL DEFAULT '{}'::jsonb;
