-- Ảnh khách upload trên Etsy (buyer-uploaded photos) — lưu [{name,url}] để hiện thumbnail + tải trong item.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS buyer_files jsonb;
