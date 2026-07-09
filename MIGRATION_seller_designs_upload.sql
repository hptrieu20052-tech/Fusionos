-- Cho seller UPLOAD design (của mình) trong Design Studio.
-- Trước đây seller chỉ có designs=1 (chỉ xem) nên mọi route ghi (tạo design, upload-url,
-- register-file, process) đều chặn ở mức >=2 → không upload được.
-- Nâng seller lên designs=2 (toàn quyền) + scope 'own' để chỉ thấy/sửa design của chính mình.
-- Ghi đè riêng theo từng người ở trang "Phân quyền theo từng người" vẫn thắng migration này.

UPDATE role_permissions SET level = 2 WHERE role = 'seller' AND module = 'designs';
INSERT INTO role_permissions (role, module, level) VALUES ('seller','designs',2)
  ON CONFLICT (role, module) DO UPDATE SET level = EXCLUDED.level;

INSERT INTO role_data_scopes (role, resource, scope) VALUES ('seller','designs','own')
  ON CONFLICT (role, resource) DO UPDATE SET scope = EXCLUDED.scope;
