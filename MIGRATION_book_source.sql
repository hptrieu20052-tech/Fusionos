-- Custom books: bản khách nhớ master gốc (mở lại màn Customize + remake theo ảnh gốc)
ALTER TABLE book_titles ADD COLUMN IF NOT EXISTS source_id uuid;
