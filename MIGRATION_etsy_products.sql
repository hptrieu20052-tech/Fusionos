-- MANAGE PRODUCTS ETSY: bảng listing Etsy import từ CSV (không dùng API Etsy).
-- Chạy trong Supabase SQL Editor TRƯỚC khi deploy code, chạy lại nhiều lần vô hại.

CREATE TABLE IF NOT EXISTS etsy_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  price numeric(12,2),
  currency text DEFAULT 'USD',
  quantity integer,
  tags text,
  materials text,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  variations jsonb NOT NULL DEFAULT '[]'::jsonb,
  sku text,
  status text NOT NULL DEFAULT 'active',
  imported_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- AI tối ưu SEO cho Shopify: title NGẮN + tag chuẩn (không đè title gốc Etsy dùng để dedupe)
ALTER TABLE etsy_products ADD COLUMN IF NOT EXISTS shopify_title text;
ALTER TABLE etsy_products ADD COLUMN IF NOT EXISTS shopify_tags text;
ALTER TABLE etsy_products ADD COLUMN IF NOT EXISTS shopify_desc text;

CREATE INDEX IF NOT EXISTS idx_etsy_products_store ON etsy_products (store_id);

-- Bảng mới cũng phải theo chuẩn bảo mật đã chốt (Data API tắt + RLS bật, không policy)
ALTER TABLE etsy_products ENABLE ROW LEVEL SECURITY;
