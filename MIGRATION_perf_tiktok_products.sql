-- ===== PERF: index cho Manage Products TikTok + Promotion product picker =====
-- Chạy trong Supabase SQL Editor. Chạy lại an toàn.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trang list: ORDER BY tt_update_time DESC theo store trong phạm vi seller
CREATE INDEX IF NOT EXISTS idx_ttp_store_updated ON tiktok_products (store_id, tt_update_time DESC);

-- Filter theo status (mặc định ACTIVATE) + promotion product picker (store_id + status=ACTIVATE)
CREATE INDEX IF NOT EXISTS idx_ttp_store_status ON tiktok_products (store_id, status);

-- Search theo title (promotion picker ILIKE %...%)
CREATE INDEX IF NOT EXISTS idx_ttp_title_trgm ON tiktok_products USING gin (title gin_trgm_ops);
