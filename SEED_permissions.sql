-- SEED phân quyền theo workflow công ty. Chạy SAU khi đã tạo bảng role_restrictions.
-- Chạy trên Supabase SQL Editor. Chạy lại an toàn (ON CONFLICT update).

-- ===== Quyền module (0 ẩn · 1 xem · 2 toàn quyền) =====
INSERT INTO role_permissions (role, module, level) VALUES
  -- SELLER: Add Store, Kéo Order, Gửi Idea, Upload/Check Design (của mình), Dán ID Design vào Order (KHÔNG fulfill)
  ('seller','dashboard',1),('seller','orders',2),('seller','fulfillment',0),('seller','designs',2),
  ('seller','finance',0),('seller','hr',0),('seller','stores',2),('seller','settings',0),
  -- DESIGNER: Thiết kế, Upload/Sửa file
  ('designer','dashboard',1),('designer','orders',0),('designer','fulfillment',0),('designer','designs',2),
  ('designer','finance',0),('designer','hr',0),('designer','stores',0),('designer','settings',0),
  -- SUPPORT: Đẩy đơn, Khiếu nại nhà in, Thống kê, Kiểm toán, Tính lương
  ('support','dashboard',2),('support','orders',2),('support','fulfillment',2),('support','designs',1),
  ('support','finance',2),('support','hr',1),('support','stores',1),('support','settings',0)
ON CONFLICT (role, module) DO UPDATE SET level = EXCLUDED.level;

-- ===== Giới hạn dữ liệu theo role =====
INSERT INTO role_restrictions (role, restriction_key, enabled) VALUES
  -- Seller: chỉ đơn/store của mình. Cho xem lợi nhuận để cân đối giá bán (kiểm toán/lương vẫn của Support)
  ('seller','own_orders_only',true),('seller','hide_profit',false),
  ('seller','own_designs_only',false),('seller','hide_customer_info',false),
  -- Designer: chỉ design của mình, ẩn lợi nhuận + thông tin khách
  ('designer','own_designs_only',true),('designer','hide_profit',true),('designer','hide_customer_info',true),
  ('designer','own_orders_only',false),
  -- Support: KHÔNG giới hạn (cần đủ dữ liệu để kiểm toán/tính lương/thống kê)
  ('support','own_orders_only',false),('support','hide_profit',false),
  ('support','own_designs_only',false),('support','hide_customer_info',false)
ON CONFLICT (role, restriction_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- ===== Phạm vi dữ liệu (all/team/own) — chạy sau khi có bảng role_data_scopes =====
INSERT INTO role_data_scopes (role, resource, scope) VALUES
  ('seller','orders','own'),   ('seller','designs','own'),   ('seller','dashboard','team'),
  ('designer','designs','own'),('designer','orders','all'),  ('designer','dashboard','team'),
  ('support','orders','all'),  ('support','designs','all'),  ('support','dashboard','all')
ON CONFLICT (role, resource) DO UPDATE SET scope = EXCLUDED.scope;
