-- Giới hạn dữ liệu theo role (ẩn lợi nhuận, chỉ đơn/design của mình, ẩn thông tin khách…)
-- Chạy trên Supabase SQL Editor. An toàn, chỉ thêm bảng.
CREATE TABLE IF NOT EXISTS role_restrictions (
  role user_role NOT NULL,
  restriction_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role, restriction_key)
);
