-- Favicon/logo cho từng nhà fulfill (upload).
ALTER TABLE fulfillers ADD COLUMN IF NOT EXISTS logo_key text;
