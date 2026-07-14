-- Dọn dữ liệu shop health RÁC do bản extension cũ ghi vào.
--
-- Bug cũ: Number(null) = 0 và isFinite(0) = true → khi fetch trang Etsy thất bại (bị chặn 403),
-- các giá trị null bị biến thành 0 rồi lưu vào DB → card hiện "0 (0) · 0 sales" và badge SUSPENDED oan.
--
-- Bản mới (extension v1.4.0) không bao giờ ghi số 0 giả nữa, nhưng cũng KHÔNG ghi đè số cũ bằng null
-- (để tránh xoá mất số liệu tốt). Nên phải xoá rác một lần bằng tay.
--
-- Sau khi chạy: card ẩn hàng số liệu, chờ seller mở Shop Manager là tự nạp số thật.

UPDATE stores
SET health = health
  - 'shopSales'
  - 'shopRating'
  - 'shopReviews'
  - 'shopListings'
  - 'shopAge'
  - 'shopLive'
  - 'shopStatus'
  - 'shopCheckFailed'
  - 'shopCheckedAt'
WHERE marketplace = 'etsy'
  AND health ? 'shopCheckedAt';

-- Kiểm tra: phải trả về 0 dòng
SELECT name, health->>'shopSales' AS sales, health->>'shopRating' AS rating
FROM stores
WHERE marketplace = 'etsy' AND health ? 'shopCheckedAt';
