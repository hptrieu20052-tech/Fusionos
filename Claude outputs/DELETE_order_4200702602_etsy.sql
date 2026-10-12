-- ════════════════════════════════════════════════════════════════════════════
-- XÓA đơn Etsy #4200702602 (CorneliusCop) khỏi FUSION để extension kéo lại từ đầu.
-- Đơn ingest hỏng: 1 dòng "Etsy order 4200702602", qty 1, price $0.00, không có item thật.
-- Chạy TRÊN SUPABASE SQL EDITOR — chạy từng khối theo thứ tự.
-- ════════════════════════════════════════════════════════════════════════════

-- ── BƯỚC 1 · SOI TRƯỚC KHI XÓA (phải ra ĐÚNG 1 dòng, store = CorneliusCop) ──
SELECT o.id, o.external_id, s.name AS store, o.status, o.total, o.ordered_at,
       (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id)          AS items,
       (SELECT count(*) FROM fulfillment_orders fo WHERE fo.order_id = o.id)   AS ff_pushes,
       (SELECT count(*) FROM transactions t WHERE t.order_id = o.id)           AS tx_rows
FROM orders o JOIN stores s ON s.id = o.store_id
WHERE o.platform = 'etsy' AND o.external_id = '4200702602';

-- ⚠ Nếu ff_pushes > 0: đơn ĐÃ từng đẩy nhà in — DỪNG LẠI kiểm tra bên supplier trước khi xóa.

-- ── BƯỚC 2 · XÓA (1 transaction, scope chặt theo platform + external_id + store) ──
BEGIN;

WITH target AS (
  SELECT o.id FROM orders o JOIN stores s ON s.id = o.store_id
  WHERE o.platform = 'etsy' AND o.external_id = '4200702602' AND s.name = 'CorneliusCop'
)
DELETE FROM fulfillment_orders WHERE order_id IN (SELECT id FROM target);

WITH target AS (
  SELECT o.id FROM orders o JOIN stores s ON s.id = o.store_id
  WHERE o.platform = 'etsy' AND o.external_id = '4200702602' AND s.name = 'CorneliusCop'
)
DELETE FROM transactions WHERE order_id IN (SELECT id FROM target);

-- order_items + order_issues có ON DELETE CASCADE → tự rụng theo đơn
WITH target AS (
  SELECT o.id FROM orders o JOIN stores s ON s.id = o.store_id
  WHERE o.platform = 'etsy' AND o.external_id = '4200702602' AND s.name = 'CorneliusCop'
)
DELETE FROM orders WHERE id IN (SELECT id FROM target);

COMMIT;

-- ── BƯỚC 3 · XÁC NHẬN (phải ra 0 dòng) ──
SELECT 1 FROM orders WHERE platform = 'etsy' AND external_id = '4200702602';
