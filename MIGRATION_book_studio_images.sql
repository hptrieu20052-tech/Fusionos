-- Book Studio MVP‑2 (Gen Image): reference nhân vật + ảnh minh hoạ từng trang. An toàn. Chạy trên Supabase SQL Editor.
ALTER TABLE book_titles ADD COLUMN IF NOT EXISTS character_ref_key text;
ALTER TABLE book_titles ADD COLUMN IF NOT EXISTS style_prompt text;

CREATE TABLE IF NOT EXISTS book_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id uuid NOT NULL REFERENCES book_titles(id) ON DELETE CASCADE,
  page_no integer NOT NULL,
  storage_key text NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookassets_title ON book_assets(title_id);
