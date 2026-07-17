-- Gửi đơn cho Designer qua Telegram: chat id riêng của designer + tracking đã gửi.
ALTER TABLE users  ADD COLUMN IF NOT EXISTS telegram_chat_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS designer_sent_to text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS designer_sent_at timestamptz;
