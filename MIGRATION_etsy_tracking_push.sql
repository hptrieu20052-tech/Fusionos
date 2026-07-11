-- Đánh dấu tracking đã đẩy ngược lên Etsy qua API (createReceiptShipment).
ALTER TABLE fulfillment_orders
  ADD COLUMN IF NOT EXISTS etsy_tracking_pushed_at timestamptz;
