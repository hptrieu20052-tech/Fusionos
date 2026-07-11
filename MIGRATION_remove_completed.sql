-- Bỏ status "completed" khỏi sử dụng: chuyển đơn completed cũ sang "delivered".
-- (Giá trị 'completed' vẫn tồn tại trong enum vì Postgres không cho xoá enum value,
--  nhưng app không dùng/hiển thị nữa.)
UPDATE orders SET status = 'delivered' WHERE status = 'completed';
