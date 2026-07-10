-- Cho Seller Report + Designer Report ở Dashboard lọc theo PHẠM VI DASHBOARD (không phải theo orders/designs).
-- Nhờ đó set "Dashboard = Xem của Team" ở Phân quyền sẽ khiến 2 report này hiện cả nhóm,
-- trong khi trang Orders vẫn giữ scope riêng (seller chỉ thấy đơn của mình).
--
-- Mặc định: seller & designer = team (thấy nhóm mình), support = all (thấy toàn bộ), admin luôn all.
-- Đặt riêng theo từng người ở trang "Phân quyền theo từng người" vẫn thắng migration này.
--
-- Lưu ý: "team" dựa trên cột users.team — muốn thấy nhiều người thì các thành viên phải cùng team.
-- Nếu chưa cấu hình team, "team" = chỉ chính mình.

INSERT INTO role_data_scopes (role, resource, scope) VALUES
  ('seller','dashboard','team'),
  ('designer','dashboard','team'),
  ('support','dashboard','all')
ON CONFLICT (role, resource) DO UPDATE SET scope = EXCLUDED.scope;
