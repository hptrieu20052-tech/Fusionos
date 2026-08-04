-- v130 — COST ĐI THEO DOANH THU
--
-- Vấn đề còn sót của v129: v129 mới khoá DOANH THU (orders.seller_at_order), chưa khoá COST.
-- Bút toán chi phí (transactions type='base_cost'...) được ghi với seller_id = CHỦ SHOP HIỆN TẠI.
-- Sau bàn giao, seller mới đẩy đơn CŨ lên nhà in → cost rơi vào seller mới, trong khi doanh thu
-- của đơn đó vẫn ở seller cũ. Kết quả: seller cũ LÃI ẢO, seller mới LỖ ẢO.
--
-- Trang Finance tính rev theo orders.seller_at_order nhưng tính cost theo transactions.seller_id
-- (2 chỗ khác nhau) nên sai lệch này hiện ra ngay trên báo cáo.
--
-- Code v130 đã sửa 4 chỗ ghi bút toán để dùng seller_at_order. Câu dưới nắn lại dữ liệu CŨ.
-- Chạy 1 lần. Idempotent — chạy lại nhiều lần không sao.

-- Xem trước có bao nhiêu dòng lệch (chạy riêng, đọc số rồi mới chạy UPDATE):
SELECT count(*) AS so_dong_lech
FROM transactions t JOIN orders o ON o.id = t.order_id
WHERE o.seller_at_order IS NOT NULL
  AND t.seller_id IS DISTINCT FROM o.seller_at_order;

-- Nắn lại: mọi bút toán gắn với 1 đơn phải ghi công cho chủ shop LÚC ĐƠN VỀ.
UPDATE transactions t
SET seller_id = o.seller_at_order
FROM orders o
WHERE o.id = t.order_id
  AND o.seller_at_order IS NOT NULL
  AND t.seller_id IS DISTINCT FROM o.seller_at_order;

-- Kiểm tra lại: phải ra 0.
SELECT count(*) AS con_lech
FROM transactions t JOIN orders o ON o.id = t.order_id
WHERE o.seller_at_order IS NOT NULL
  AND t.seller_id IS DISTINCT FROM o.seller_at_order;
