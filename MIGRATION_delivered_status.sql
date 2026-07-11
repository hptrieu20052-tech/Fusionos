-- Thêm trạng thái "delivered" (nhà in báo đã giao) vào enum order_status.
-- Supabase (PG 15) cho phép ADD VALUE chạy trực tiếp trong SQL Editor.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'delivered' AFTER 'shipped';
