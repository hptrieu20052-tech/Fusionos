-- ============================================================================
-- CÂN LẠI SỔ GIÁ VỐN (base_cost) — chạy 1 lần trong Supabase SQL Editor
--
-- Bug: refundOrderCost() chèn dòng hoàn tiền (+X) với note "Refund cost — …",
-- KHÔNG chứa external_ff_id. Khi xoá bản ghi đẩy, route DELETE chỉ xoá bút toán
-- có note khớp external_ff_id (−X) → dòng +X nằm lại mồ côi → Dashboard/Finance
-- hiện Fulfillment cost ÂM và Est. profit bị thổi lên.
--
-- Quy tắc đúng: SUM(base_cost) của 1 đơn phải = -(tổng cost các bản ghi đẩy còn
-- lại, không tính bản ghi đã cancelled).
-- ============================================================================

-- Xem trước các đơn đang LỆCH (chạy riêng để kiểm tra trước khi sửa)
--   SELECT o.id, o.external_id,
--     -coalesce((SELECT sum(coalesce(f.cost,0)) FROM fulfillment_orders f
--                WHERE f.order_id = o.id AND f.status <> 'cancelled'),0) AS target,
--     coalesce((SELECT sum(t.amount) FROM transactions t
--               WHERE t.order_id = o.id AND t.type = 'base_cost'),0) AS current
--   FROM orders o
--   WHERE abs(
--     -coalesce((SELECT sum(coalesce(f.cost,0)) FROM fulfillment_orders f
--                WHERE f.order_id = o.id AND f.status <> 'cancelled'),0)
--     - coalesce((SELECT sum(t.amount) FROM transactions t
--                 WHERE t.order_id = o.id AND t.type = 'base_cost'),0)
--   ) >= 0.005;

BEGIN;

-- 1) Đơn KHÔNG còn bản ghi đẩy nào có chi phí → xoá sạch bút toán base_cost
--    (dọn đúng dòng refund mồ côi +16 của trường hợp bạn gặp)
DELETE FROM transactions t
WHERE t.type = 'base_cost'
  AND t.order_id IS NOT NULL
  AND coalesce((
        SELECT sum(coalesce(f.cost, 0)) FROM fulfillment_orders f
        WHERE f.order_id = t.order_id AND f.status <> 'cancelled'
      ), 0) = 0;

-- 2) Đơn còn chi phí thật nhưng sổ lệch → chèn 1 dòng điều chỉnh cho khớp
INSERT INTO transactions (type, amount, currency, order_id, store_id, seller_id, note, occurred_at)
SELECT 'base_cost', (x.target - x.cur)::numeric(12,2), 'USD',
       x.order_id, o.store_id, o.seller_id,
       'Cost adjustment — rebalance', current_date
FROM (
  SELECT o.id AS order_id,
    -coalesce((SELECT sum(coalesce(f.cost,0)) FROM fulfillment_orders f
               WHERE f.order_id = o.id AND f.status <> 'cancelled'), 0) AS target,
    coalesce((SELECT sum(t.amount) FROM transactions t
              WHERE t.order_id = o.id AND t.type = 'base_cost'), 0) AS cur
  FROM orders o
) x
JOIN orders o ON o.id = x.order_id
WHERE abs(x.target - x.cur) >= 0.005;

COMMIT;
