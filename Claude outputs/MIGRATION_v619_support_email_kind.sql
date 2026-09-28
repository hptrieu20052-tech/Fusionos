-- v619 · Customer Emails: phân loại thread KHÁCH THẬT (customer) / QUẢNG CÁO (promo)
-- + spam-rescue: mail khách rơi vào Spam vẫn hiện ở view "Customers" kèm chip cam, không bị xót.
-- Chạy 1 lần trong Supabase SQL Editor. Idempotent (chạy lại không sao).

ALTER TABLE support_email_threads ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'customer';
CREATE INDEX IF NOT EXISTS idx_sup_email_threads_kind ON support_email_threads(kind);

-- 1) Backfill promo cho thread cũ: địa chỉ máy gửi hàng loạt (no-reply/newsletter/marketing…).
--    Mail từ hệ thống Shopify (contact form, notification) luôn giữ là customer.
UPDATE support_email_threads SET kind = 'promo'
WHERE customer_email ~* '^(no-?reply|noreply|do-?not-?reply|donotreply|newsletters?|news|marketing|promotions?|promo|offers?|deals|notifications?|notify|updates?|digest|campaigns?)@'
  AND customer_email !~* '@([a-z0-9-]+\.)*shopify(email)?\.com$';

-- 2) Backfill promo theo nội dung: mail đến có nút unsubscribe (dấu hiệu mail gửi hàng loạt).
UPDATE support_email_threads t SET kind = 'promo'
WHERE t.kind = 'customer'
  AND t.customer_email !~* '@([a-z0-9-]+\.)*shopify(email)?\.com$'
  AND EXISTS (
    SELECT 1 FROM support_email_messages m
    WHERE m.thread_id = t.id AND m.direction = 'in'
      AND (m.body_html ILIKE '%unsubscribe%' OR m.body_text ILIKE '%unsubscribe%')
  );

-- 3) Thread mình ĐÃ TỪNG trả lời = chắc chắn khách thật → kéo lại customer.
UPDATE support_email_threads t SET kind = 'customer'
WHERE t.kind = 'promo'
  AND EXISTS (SELECT 1 FROM support_email_messages m WHERE m.thread_id = t.id AND m.direction = 'out');

-- 4) Spam-rescue cho mail cũ (14 ngày gần nhất): mail khách thật đang nằm trong Spam,
--    chưa từng được trả lời → đánh unread + mở thread để hiện ngay trên view Customers.
UPDATE support_email_threads t SET unread = true, status = 'open'
WHERE t.kind = 'customer' AND t.unread = false AND t.last_direction = 'in'
  AND t.last_message_at > now() - interval '14 days'
  AND EXISTS (SELECT 1 FROM support_email_messages m WHERE m.thread_id = t.id AND m.direction = 'in' AND m.folder = 'spam')
  AND NOT EXISTS (SELECT 1 FROM support_email_messages m WHERE m.thread_id = t.id AND m.direction = 'out');
