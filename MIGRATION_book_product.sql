-- Book Studio · loại sản phẩm in cho mỗi đầu sách (Hardcover Photo Book…)
-- Chạy trên Supabase SQL Editor (idempotent).
ALTER TABLE book_titles ADD COLUMN IF NOT EXISTS product_key text;
