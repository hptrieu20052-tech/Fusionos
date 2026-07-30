-- Manage Templates · Shopify — bảng preset (variants + giá theo tổ hợp + collection/kênh/tags/status/type/vendor/theme/category).
-- Chạy 1 lần trong Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS shopify_templates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           uuid NOT NULL,
  name               text NOT NULL,
  options            jsonb NOT NULL DEFAULT '[]'::jsonb,
  variants           jsonb NOT NULL DEFAULT '[]'::jsonb,
  collection_ids     jsonb NOT NULL DEFAULT '[]'::jsonb,
  publication_ids    jsonb NOT NULL DEFAULT '[]'::jsonb,
  status             text NOT NULL DEFAULT 'DRAFT',
  product_type       text,
  vendor             text,
  theme_template     text,
  category           jsonb,
  category_metafields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shopify_templates_store ON shopify_templates (store_id);
