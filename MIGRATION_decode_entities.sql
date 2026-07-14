-- Backfill: decode HTML entity trong dữ liệu đơn CŨ đã kéo về trước bản vá.
--
-- Vì sao cần: UI đã decode lúc hiển thị nên đơn cũ TRÔNG đúng ngay sau khi deploy.
-- Nhưng DB vẫn lưu chuỗi bẩn ("8&#39;&#39;"), mà fulfillment/push lấy variant THẲNG TỪ DB
-- gửi sang nhà in → nhà in nhận chuỗi rác và có thể in sai size.
--
-- Chạy 1 lần. An toàn khi chạy lại (chuỗi đã sạch thì không đổi gì).

-- 1) Hàm decode: xử lý cả entity SỐ (&#39; &#x27;) lẫn entity TÊN (&quot; &amp;)
CREATE OR REPLACE FUNCTION decode_entities(t text) RETURNS text AS $$
DECLARE
  r text := t;
  m text[];
BEGIN
  IF r IS NULL OR r NOT LIKE '%&%' THEN RETURN r; END IF;

  -- Entity số hệ 10:  &#39;  →  '
  FOR m IN SELECT regexp_matches(r, '&#(\d{1,7});', 'g') LOOP
    BEGIN
      r := replace(r, '&#' || m[1] || ';', chr(m[1]::int));
    EXCEPTION WHEN others THEN NULL; -- mã lạ thì bỏ qua, giữ nguyên
    END;
  END LOOP;

  -- Entity số hệ 16:  &#x27;  →  '
  FOR m IN SELECT regexp_matches(r, '&#[xX]([0-9a-fA-F]{1,6});', 'g') LOOP
    BEGIN
      r := regexp_replace(r, '&#[xX]' || m[1] || ';',
                          chr(('x' || lpad(m[1], 8, '0'))::bit(32)::int), 'g');
    EXCEPTION WHEN others THEN NULL;
    END;
  END LOOP;

  -- Entity tên
  r := replace(r, '&quot;',   '"');
  r := replace(r, '&apos;',   '''');
  r := replace(r, '&lt;',     '<');
  r := replace(r, '&gt;',     '>');
  r := replace(r, '&nbsp;',   ' ');
  r := replace(r, '&middot;', '·');
  r := replace(r, '&hellip;', '…');
  r := replace(r, '&mdash;',  '—');
  r := replace(r, '&ndash;',  '–');
  r := replace(r, '&ldquo;',  '“');
  r := replace(r, '&rdquo;',  '”');
  r := replace(r, '&lsquo;',  '‘');
  r := replace(r, '&rsquo;',  '’');
  r := replace(r, '&deg;',    '°');
  r := replace(r, '&times;',  '×');
  -- &amp; PHẢI decode CUỐI CÙNG, nếu không "&amp;quot;" sẽ bị decode 2 lần thành '"'
  r := replace(r, '&amp;',    '&');

  RETURN r;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- 2) XEM TRƯỚC khi sửa — chạy riêng câu này để kiểm tra kết quả trước
SELECT
  id,
  variant                  AS variant_cu,
  decode_entities(variant) AS variant_moi
FROM order_items
WHERE variant LIKE '%&%'
LIMIT 20;


-- 3) Backfill thật. Bỏ comment và chạy khi đã xem ở bước 2 thấy ổn.
-- BEGIN;
--
-- UPDATE order_items
-- SET variant         = decode_entities(variant),
--     personalization = decode_entities(personalization),
--     product_title   = decode_entities(product_title)
-- WHERE variant LIKE '%&%'
--    OR personalization LIKE '%&%'
--    OR product_title LIKE '%&%';
--
-- COMMIT;


-- 4) Kiểm tra sau khi chạy: phải trả về 0 dòng
-- SELECT count(*) AS con_ban
-- FROM order_items
-- WHERE variant LIKE '%&#%' OR variant LIKE '%&quot;%'
--    OR personalization LIKE '%&#%' OR product_title LIKE '%&#%';
