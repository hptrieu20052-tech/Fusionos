-- Hồ sơ nhân sự: ngày vào làm + file hợp đồng (date_of_birth đã có sẵn).
-- Chạy trong Supabase SQL Editor. Chạy lại an toàn.
ALTER TABLE users ADD COLUMN IF NOT EXISTS started_at date;
ALTER TABLE users ADD COLUMN IF NOT EXISTS contract_key text;
