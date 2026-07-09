-- Cho seller XEM lợi nhuận (Base cost / Ship fee / Total / Profit after cost) để cân đối giá bán.
-- Trước đây seller bị hide_profit=true nên card fulfillment ẩn hết số liệu chi phí/lợi nhuận.
-- Ghi đè riêng theo từng người ở trang "Phân quyền theo từng người" vẫn thắng migration này.

UPDATE role_restrictions SET enabled = false WHERE role = 'seller' AND restriction_key = 'hide_profit';
INSERT INTO role_restrictions (role, restriction_key, enabled) VALUES ('seller','hide_profit',false)
  ON CONFLICT (role, restriction_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- Nếu trước đó đã đặt riêng hide_profit=true cho seller nào ở user_restrictions thì gỡ để về mặc định role:
DELETE FROM user_restrictions ur
USING users u
WHERE ur.user_id = u.id AND u.role = 'seller' AND ur.restriction_key = 'hide_profit' AND ur.enabled = true;
