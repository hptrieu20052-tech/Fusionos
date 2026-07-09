-- Cho phép nhiều mặt in (sleeve, các tháng lịch…) — đổi kind từ enum sang text. An toàn, giữ nguyên dữ liệu.
-- Chạy trên Supabase SQL Editor.
ALTER TABLE design_files ALTER COLUMN kind DROP DEFAULT;
ALTER TABLE design_files ALTER COLUMN kind TYPE text USING kind::text;
