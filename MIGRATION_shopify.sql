-- KẾT NỐI SHOPIFY → FUSION. Chạy trong Supabase SQL Editor TRƯỚC khi deploy code.
-- ALTER TYPE ADD VALUE phải chạy NGOÀI transaction (Supabase SQL Editor chạy từng câu là được).

-- 1) Thêm 'shopify' vào enum marketplace (đặt trước 'other' cho gọn; IF NOT EXISTS = chạy lại vô hại).
ALTER TYPE marketplace ADD VALUE IF NOT EXISTS 'shopify';

-- 2) Cột đánh dấu đã đẩy tracking ngược lên Shopify.
ALTER TABLE fulfillment_orders ADD COLUMN IF NOT EXISTS shopify_tracking_pushed_at timestamptz;

-- 3) (Tuỳ chọn) tạo store Shopify để nhận đơn. Chạy SQL mẫu — chọn ĐÚNG kiểu app:
--
-- === App Dev Dashboard (mới, khuyên dùng — token tự đổi qua client_credentials) ===
-- Lấy SELLER_UUID: SELECT id, full_name, email, role FROM users WHERE role IN ('admin','seller');
-- connect_method BẮT BUỘC: 'api' cho Shopify (nhận đơn qua webhook).
-- INSERT INTO stores (name, marketplace, connect_method, seller_id, fee_rate, api_credentials)
-- VALUES ('Talewix', 'shopify', 'api', '<SELLER_UUID>', 3.0,
--   jsonb_build_object(
--     'shopDomain','talewix.myshopify.com',
--     'clientId','<CLIENT_ID>',
--     'clientSecret','<CLIENT_SECRET>'   -- dùng luôn để verify HMAC webhook
--   ));
--
-- === App custom cũ (nếu store còn cho, token cố định shpat_) ===
-- INSERT INTO stores (name, marketplace, connect_method, seller_id, fee_rate, api_credentials)
-- VALUES ('Talewix', 'shopify', 'api', '<SELLER_UUID>', 3.0,
--   jsonb_build_object('shopDomain','talewix.myshopify.com','adminToken','<shpat_...>','webhookSecret','<SECRET>'));
--
-- fee_rate 3.0 = ~3% phí thanh toán → Fee (est.) tự tính.
-- shopDomain: dạng "xxx.myshopify.com" (KHÔNG phải talewix.com).
