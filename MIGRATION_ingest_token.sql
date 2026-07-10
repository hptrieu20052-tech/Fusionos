-- Token cho Extension "Kéo đơn Etsy về FUSION". Mỗi store 1 token (Bearer) để đẩy đơn về /api/ingest/etsy.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS ingest_token text;

-- Sinh token cho các store hiện có (dùng pgcrypto có sẵn trên Supabase).
UPDATE stores
SET ingest_token = replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')
WHERE ingest_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_stores_ingest_token ON stores (ingest_token);
