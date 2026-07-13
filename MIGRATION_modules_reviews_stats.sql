-- Thêm 2 module mới vào RBAC: reviews (Chấm điểm) và statsDesigners (TK Designer).
-- Trước đây 2 trang này hardcode "chỉ admin"; giờ chạy theo quyền như mọi module khác.
--
-- Mức: 0 = ẩn · 1 = chỉ xem · 2 = toàn quyền
-- Admin luôn full (không cần dòng nào, levelOf() trả 2 cứng cho admin).
--
-- Mặc định giữ nguyên hành vi cũ: mọi role đều 0 (ẩn) → menu không đổi với ai.
-- Muốn mở cho ai thì vào Admin → Permissions bật lên, hoặc sửa các dòng dưới trước khi chạy.

INSERT INTO role_permissions (role, module, level) VALUES
  ('seller',   'reviews',        0),
  ('designer', 'reviews',        0),
  ('support',  'reviews',        0),
  ('content',  'reviews',        0),
  ('hiring',   'reviews',        0),
  ('seller',   'statsDesigners', 0),
  ('designer', 'statsDesigners', 0),
  ('support',  'statsDesigners', 0),
  ('content',  'statsDesigners', 0),
  ('hiring',   'statsDesigners', 0)
ON CONFLICT (role, module) DO NOTHING;
