-- Sản phẩm TikTok kéo về (Manage Products).
CREATE TABLE IF NOT EXISTS tiktok_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  tiktok_product_id text NOT NULL,
  title text,
  status text,
  main_image_url text,
  category_id text,
  category_name text,
  seller_sku text,
  price_min numeric(12,2),
  tt_create_time timestamptz,
  tt_update_time timestamptz,
  raw jsonb,
  synced_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tt_product ON tiktok_products (store_id, tiktok_product_id);
