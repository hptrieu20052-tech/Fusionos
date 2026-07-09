-- Quyền hành động chi tiết (tick từng action như AdsPower). Chạy trên Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS role_actions (
  role user_role NOT NULL,
  action_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (role, action_key)
);
