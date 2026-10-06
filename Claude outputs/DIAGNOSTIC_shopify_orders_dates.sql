-- ════════════════════════════════════════════════════════════════════════════
-- CHẨN ĐOÁN: số Shopify trên Finance giống nhau ở mọi khoảng ngày (10/2026)
-- Chỉ SELECT — không sửa dữ liệu. Chạy từng khối trên Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Phân bố đơn Shopify theo NGÀY (ordered_at) — xem đơn có bị dồn cục vào
--    vài ngày gần đây không, hay trải đều theo thời gian thật.
SELECT o.ordered_at::date AS day,
       count(*)           AS orders,
       round(sum(o.total)::numeric, 2) AS revenue
FROM orders o
WHERE o.platform = 'shopify'
  AND o.status NOT IN ('cancel','trash')
GROUP BY 1
ORDER BY 1 DESC;

-- 2) Đơn Shopify TRÙNG external_id — nghi re-import tạo bản sao (1 đơn 2 dòng,
--    bản cũ ngày cũ + bản mới ngày mới → range nào cũng "bắt" đúng 1 bản nên
--    Finance ra số y hệt nhau ở This month lẫn Last month).
SELECT o.external_id,
       count(*) AS copies,
       array_agg(o.ordered_at::date ORDER BY o.ordered_at) AS dates,
       array_agg(o.status ORDER BY o.ordered_at)           AS statuses,
       array_agg(o.id ORDER BY o.ordered_at)               AS order_ids
FROM orders o
WHERE o.platform = 'shopify'
GROUP BY 1
HAVING count(*) > 1
ORDER BY 2 DESC, 1
LIMIT 50;

-- 3) Mô phỏng 2 dòng Finance theo seller: Last month (9/2026) vs This month
--    (1–6/10/2026). Nếu cột sep_* và oct_* ra số GIỐNG HỆT nhau từng seller
--    → chắc chắn dữ liệu bị nhân đôi theo kiểu trên.
SELECT coalesce(u.full_name, '(no seller)') AS seller,
       count(*)        FILTER (WHERE o.ordered_at::date BETWEEN '2026-09-01' AND '2026-09-30') AS sep_orders,
       round(sum(o.total) FILTER (WHERE o.ordered_at::date BETWEEN '2026-09-01' AND '2026-09-30')::numeric, 2) AS sep_rev,
       count(*)        FILTER (WHERE o.ordered_at::date BETWEEN '2026-10-01' AND '2026-10-06') AS oct_orders,
       round(sum(o.total) FILTER (WHERE o.ordered_at::date BETWEEN '2026-10-01' AND '2026-10-06')::numeric, 2) AS oct_rev
FROM orders o
LEFT JOIN users u ON u.id = o.seller_at_order
WHERE o.platform = 'shopify'
  AND o.status NOT IN ('cancel','trash')
GROUP BY 1
ORDER BY oct_rev DESC NULLS LAST;
