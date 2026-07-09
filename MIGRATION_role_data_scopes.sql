-- Phạm vi dữ liệu theo role: all / team / own (cho orders, designs). Chạy trên Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS role_data_scopes (
  role user_role NOT NULL,
  resource text NOT NULL,
  scope text NOT NULL DEFAULT 'all',
  PRIMARY KEY (role, resource)
);
