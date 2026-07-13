-- PKCE verifier lưu SERVER-SIDE thay vì cookie.
--
-- Vấn đề cũ: verifier nằm trong cookie httpOnly `etsy_oauth` → callback bắt buộc phải quay về
-- đúng browser đã bấm "Connect Etsy". Muốn authorize shop trong AdsPower thì phải đăng nhập
-- Fusion OS ngay trong AdsPower → rủi ro lộ session nếu profile đó bị xâm nhập.
--
-- Cách mới: sinh `state` random (32 byte), lưu verifier + store_id vào bảng này.
-- Callback tra verifier theo `state`, không cần cookie, không cần session.
-- → Copy connect link dán vào AdsPower là chạy. Fusion OS KHÔNG BAO GIỜ login trên AdsPower.
--
-- `state` dùng một lần, xoá ngay sau khi đổi token, và hết hạn sau 10 phút.

CREATE TABLE IF NOT EXISTS oauth_pending (
  state      text PRIMARY KEY,
  verifier   text NOT NULL,
  store_id   uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Dọn rác: bản ghi quá hạn (an toàn khi chạy lại bất cứ lúc nào)
CREATE INDEX IF NOT EXISTS idx_oauth_pending_created ON oauth_pending (created_at);
