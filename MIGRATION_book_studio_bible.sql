-- Book Studio · Style Bible + Variables + per-page detailed prompt
-- Chạy trên Supabase SQL Editor (idempotent).

ALTER TABLE book_titles ADD COLUMN IF NOT EXISTS bible jsonb;
ALTER TABLE book_titles ADD COLUMN IF NOT EXISTS vars  jsonb;
ALTER TABLE book_pages  ADD COLUMN IF NOT EXISTS prompt_template text;
