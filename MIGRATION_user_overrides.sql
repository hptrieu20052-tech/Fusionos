-- Ghi đè quyền theo từng user (kiểu AdsPower). Chạy trên Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module text NOT NULL,
  level smallint NOT NULL,
  PRIMARY KEY (user_id, module)
);
CREATE TABLE IF NOT EXISTS user_data_scopes (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource text NOT NULL,
  scope text NOT NULL,
  PRIMARY KEY (user_id, resource)
);
CREATE TABLE IF NOT EXISTS user_actions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, action_key)
);
