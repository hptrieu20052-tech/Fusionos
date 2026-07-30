-- Filter Type/Category/Collections cho Manage Products · Shopify: lưu category + collections của sản phẩm.
-- Chạy 1 lần trong Supabase SQL Editor. (Product type đã có sẵn cột product_type.)
ALTER TABLE shopify_products ADD COLUMN IF NOT EXISTS category jsonb;
ALTER TABLE shopify_products ADD COLUMN IF NOT EXISTS collections jsonb NOT NULL DEFAULT '[]'::jsonb;
