-- Chạy trên Supabase SQL Editor (an toàn, chỉ thêm cột)
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS fx_rate numeric(14,4) NOT NULL DEFAULT 1;
