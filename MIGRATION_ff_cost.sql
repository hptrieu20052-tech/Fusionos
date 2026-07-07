-- Chạy trên Supabase SQL Editor (an toàn, chỉ thêm cột nullable, không mất data)
ALTER TABLE fulfillment_orders
  ADD COLUMN IF NOT EXISTS base_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS ship_cost numeric(12,2);
