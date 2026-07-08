-- Chạy trên Supabase SQL Editor (an toàn, chỉ thêm cột + index, không mất data)
ALTER TABLE sku_mappings
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_map_pinned ON sku_mappings (fulfiller_id, pinned);
