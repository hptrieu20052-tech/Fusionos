-- Book Studio: cover wraparound content (title + brief + composed prompt)
ALTER TABLE book_titles ADD COLUMN IF NOT EXISTS cover jsonb;
