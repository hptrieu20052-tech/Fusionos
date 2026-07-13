-- Blocklist đơn của HỆ THỐNG CŨ.
-- Mọi cửa ingest (extension Etsy, cron Etsy/TikTok API, import Excel) sẽ BỎ QUA
-- đơn có external_id nằm trong bảng này → không bị push đúp sang nhà in khi chạy song song 2 hệ thống.
--
-- Cách dùng khi cut-over:
--   1. Tắt cron/ingest ở hệ thống cũ (ngừng nhận đơn mới)
--   2. Export toàn bộ Order ID 30 ngày gần nhất (mọi sàn)
--   3. Settings → "Legacy orders" → dán/upload danh sách
--   4. Bỏ env INGEST_SINCE trên Vercel để FUSION kéo rộng — đơn cũ đã bị blocklist chặn

CREATE TABLE IF NOT EXISTS ignored_orders (
  external_id text PRIMARY KEY,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
