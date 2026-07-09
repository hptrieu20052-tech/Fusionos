-- Tăng tốc form Create khi SKU lớn (100k+). Chạy trên Supabase SQL Editor (an toàn, chỉ thêm index).
-- 1) Danh sách STYLE (DISTINCT product_type theo nhà fulfill, có lọc pinned)
CREATE INDEX IF NOT EXISTS idx_map_ff_pinned_product
  ON sku_mappings (fulfiller_id, pinned, product_type);

-- 2) Nạp variant của 1 sản phẩm (WHERE fulfiller_id AND product_type)
CREATE INDEX IF NOT EXISTS idx_map_ff_product
  ON sku_mappings (fulfiller_id, product_type);
