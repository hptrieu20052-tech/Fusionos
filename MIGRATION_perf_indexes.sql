-- ===== PERF: index cho các query nóng (Dashboard/Finance/Orders/Webhook/SKU search) =====
-- Chạy trong Supabase SQL Editor. Chạy lại an toàn. Bảng lớn có thể mất ~10-30s.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Orders: dashboard/report lọc theo NGÀY trên toàn bộ seller (index seller+date hiện tại không dùng được)
CREATE INDEX IF NOT EXISTS idx_orders_ordered_at ON orders (ordered_at);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders (store_id);

-- Transactions: trang Tài chính SUM theo đơn/ngày/seller — hiện chưa có index nào
CREATE INDEX IF NOT EXISTS idx_tx_order ON transactions (order_id);
CREATE INDEX IF NOT EXISTS idx_tx_occurred ON transactions (occurred_at);
CREATE INDEX IF NOT EXISTS idx_tx_seller ON transactions (seller_id);

-- Webhook Printway/FlashShip/Merchize dò đơn theo mã nhà in
CREATE INDEX IF NOT EXISTS idx_ffo_external ON fulfillment_orders (external_ff_id);

-- SKU mapping 60k+ dòng: ORDER BY của trang SKU + search ILIKE %...% (trgm)
CREATE INDEX IF NOT EXISTS idx_map_ff_product ON sku_mappings (fulfiller_id, fulfiller_product, fulfiller_sku);
CREATE INDEX IF NOT EXISTS idx_map_internal_trgm ON sku_mappings USING gin (internal_sku gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_map_fsku_trgm    ON sku_mappings USING gin (fulfiller_sku gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_map_product_trgm ON sku_mappings USING gin (fulfiller_product gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_map_variant_trgm ON sku_mappings USING gin (variant gin_trgm_ops);
