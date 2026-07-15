-- ============================================================================
-- COMPASSUP — chạy 1 lần trong Supabase SQL Editor (idempotent)
-- ============================================================================

-- 1) Cờ non_pod: nhà DROPSHIP không cần gán design mới đẩy được đơn
ALTER TABLE fulfillers   ADD COLUMN IF NOT EXISTS non_pod boolean NOT NULL DEFAULT false;

-- 2) extra_json: dữ liệu riêng nhà in không có cột chuyên biệt
--    Compassup mapping lưu: { link, sup_site, seller_id, weight, sku_id, product_id,
--                             product_name, declaration_title, image_link, custom, attachments }
ALTER TABLE sku_mappings ADD COLUMN IF NOT EXISTS extra_json jsonb;

-- 3) Tạo nhà in Compassup (đổi tenant/token/restKey/account/warehouse cho đúng của bạn).
--    Credentials là JSON — có thể sửa sau trong Settings → Fulfillers.
--    KHÔNG chạy lại nếu đã có (ON CONFLICT theo name unique).
INSERT INTO fulfillers (name, method, api_endpoint, non_pod, credentials, status)
VALUES (
  'Compassup', 'api', 'https://order.compassup.com/openapi/1', true,
  jsonb_build_object(
    'bearerToken', 'PASTE_BEARER_TOKEN',
    'tenant',      'cpstech',
    'restKey',     'PASTE_REST_KEY',
    'username',    'cpstech',
    'accountId',   'PASTE_ACCOUNT_ID',
    'warehouseId', 'PASTE_WAREHOUSE_ID',
    'goodType',    'normal',
    'transport',   'fast',
    'shippingType','seller',
    'shippingFrom','CN',
    'platform',    ''
  ),
  'connected'
)
ON CONFLICT (name) DO NOTHING;
