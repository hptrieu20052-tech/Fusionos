-- (TÙY CHỌN) Chặn trùng tên store ở tầng DB — không phân biệt hoa/thường.
-- App đã chặn khi tạo/sửa; index này là lớp bảo vệ cứng, tránh trùng do race condition.
--
-- BƯỚC 1: kiểm tra xem hiện có tên store bị trùng không (phải xử lý trước khi tạo index):
--   SELECT lower(name) AS n, count(*) FROM stores GROUP BY 1 HAVING count(*) > 1;
--   → nếu có kết quả, đổi tên các store trùng cho khác nhau rồi mới chạy bước 2.
--
-- BƯỚC 2: tạo unique index (case-insensitive). Nếu còn trùng sẽ báo lỗi, cứ xử lý xong chạy lại.
CREATE UNIQUE INDEX IF NOT EXISTS ux_stores_name_lower ON stores (lower(name));
