-- Template content: nguồn sự thật cho AI Optimize + 3 tab mô tả (Description / Product Details / Shipping)
ALTER TABLE shopify_templates ADD COLUMN IF NOT EXISTS base_description text;
ALTER TABLE shopify_templates ADD COLUMN IF NOT EXISTS product_details text;
ALTER TABLE shopify_templates ADD COLUMN IF NOT EXISTS shipping_info text;
