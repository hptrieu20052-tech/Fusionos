-- Book Studio (AI) — bảng đầu sách + trang. An toàn, IF NOT EXISTS. Chạy trên Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS book_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  occasion text,
  audience text,
  status text NOT NULL DEFAULT 'idea',
  concept jsonb,
  personalization jsonb,
  brief jsonb,
  owner_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS book_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id uuid NOT NULL REFERENCES book_titles(id) ON DELETE CASCADE,
  page_no integer NOT NULL,
  text_template text,
  illustration_brief text
);
CREATE INDEX IF NOT EXISTS idx_bookpages_title ON book_pages(title_id);
