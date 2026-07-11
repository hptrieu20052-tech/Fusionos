-- Chống trùng đơn marketplace ở TẦNG DB: unique (platform, external_id).
-- Bước 1 — soi trùng hiện có (nếu trả 0 dòng thì chạy thẳng bước 2):
--   SELECT platform, external_id, count(*) FROM orders
--   WHERE external_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;
-- Nếu có trùng: xử tay từng cặp (giữ đơn đúng, đổi status đơn thừa sang cancel) rồi mới chạy bước 2.

-- Bước 2 — tạo unique index (đơn external_id NULL như đơn tạo tay không bị ảnh hưởng):
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_platform_ext
  ON orders (platform, external_id) WHERE external_id IS NOT NULL;
