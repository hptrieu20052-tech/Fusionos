-- AI Optimize chuẩn SEO: thêm SEO meta (Page title + Meta description) cho sản phẩm Shopify.
-- Chạy 1 lần trong Supabase SQL Editor.
ALTER TABLE shopify_products ADD COLUMN IF NOT EXISTS seo_title text;
ALTER TABLE shopify_products ADD COLUMN IF NOT EXISTS seo_description text;
