-- Thông báo sale về Telegram: mỗi team gắn 1 group chat id
ALTER TABLE teams ADD COLUMN IF NOT EXISTS telegram_chat_id text;
