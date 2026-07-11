-- Đồng bộ trạng thái với nhà in: gom "trash" về "cancel".
-- Chạy trong Supabase SQL Editor. Chạy lại an toàn.
UPDATE orders SET status = 'cancel' WHERE status = 'trash';
