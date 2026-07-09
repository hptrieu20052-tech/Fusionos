-- Chạy trên Supabase SQL Editor (an toàn, chỉ thêm cột)
ALTER TABLE fulfillment_orders
  ADD COLUMN IF NOT EXISTS cost_events jsonb NOT NULL DEFAULT '{}'::jsonb;
