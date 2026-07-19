-- Book Studio: phân khu Drafts vs Scale designs (master template custom cho khách)
ALTER TABLE book_titles ADD COLUMN IF NOT EXISTS kind text;
