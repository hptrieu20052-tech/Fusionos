-- Note của KHÁCH (message from buyer trên Etsy) — tách riêng khỏi note nội bộ (staff tự ghi) để không đè nhau.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_note text;

-- BACKFILL đơn cũ: trước đây note khách bị lưu chung ở cột `note`. Chuyển sang buyer_note (nền cam),
-- và dọn cột note để staff dùng riêng. Chỉ áp cho Etsy (nơi note = message from buyer).
UPDATE orders
   SET buyer_note = note, note = NULL
 WHERE buyer_note IS NULL
   AND note IS NOT NULL AND btrim(note) <> ''
   AND platform = 'etsy';
