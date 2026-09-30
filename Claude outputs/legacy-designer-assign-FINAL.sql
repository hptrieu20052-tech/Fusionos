-- Legacy POD -> FusionOS: GÁN DESIGNER theo danh sách user hiện có (29/9/2026)
-- Chạy SAU KHI đã import designs (legacy-pod-designs-import.sql.gz).
-- Chạy trong Supabase SQL Editor bình thường (không cần psql). Chạy lại an toàn:
-- chỉ update dòng designer_id IS NULL, và mỗi câu tự vô hiệu nếu tên user không tìm thấy
-- hoặc trùng tên (guard count = 1).
-- Code KHÔNG có trong danh sách dưới -> để NULL (unassigned), admin tra qua tag trong note.

-- HONGPHUC · 9.160 designs -> Hồng Phúc
UPDATE designs SET designer_id = (SELECT id FROM users WHERE full_name ILIKE 'Hồng Phúc' LIMIT 1)
WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:HONGPHUC(\s|\])'
  AND (SELECT count(*) FROM users WHERE full_name ILIKE 'Hồng Phúc') = 1;

-- THANHTHAO · 6.319 designs -> Thanh Thảo
UPDATE designs SET designer_id = (SELECT id FROM users WHERE full_name ILIKE 'Thanh Thảo' LIMIT 1)
WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:THANHTHAO(\s|\])'
  AND (SELECT count(*) FROM users WHERE full_name ILIKE 'Thanh Thảo') = 1;

-- HOANGPHUC · 5.192 designs -> Hoàng Phúc
UPDATE designs SET designer_id = (SELECT id FROM users WHERE full_name ILIKE 'Hoàng Phúc' LIMIT 1)
WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:HOANGPHUC(\s|\])'
  AND (SELECT count(*) FROM users WHERE full_name ILIKE 'Hoàng Phúc') = 1;

-- VANMANH · 1.759 designs -> Văn Mạnh
UPDATE designs SET designer_id = (SELECT id FROM users WHERE full_name ILIKE 'Văn Mạnh' LIMIT 1)
WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:VANMANH(\s|\])'
  AND (SELECT count(*) FROM users WHERE full_name ILIKE 'Văn Mạnh') = 1;

-- DINHPHUC · 1.407 designs -> Đình Phúc (tài khoản đang locked vẫn gán được — chỉ là không đăng nhập)
UPDATE designs SET designer_id = (SELECT id FROM users WHERE full_name ILIKE 'Đình Phúc' LIMIT 1)
WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:DINHPHUC(\s|\])'
  AND (SELECT count(*) FROM users WHERE full_name ILIKE 'Đình Phúc') = 1;

-- HOAILINH · 119 designs -> Hoài Linh
UPDATE designs SET designer_id = (SELECT id FROM users WHERE full_name ILIKE 'Hoài Linh' LIMIT 1)
WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:HOAILINH(\s|\])'
  AND (SELECT count(*) FROM users WHERE full_name ILIKE 'Hoài Linh') = 1;

-- TANLOC · 115 designs -> Tấn Lộc
UPDATE designs SET designer_id = (SELECT id FROM users WHERE full_name ILIKE 'Tấn Lộc' LIMIT 1)
WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:TANLOC(\s|\])'
  AND (SELECT count(*) FROM users WHERE full_name ILIKE 'Tấn Lộc') = 1;

-- QUANGTRUONG · 1 design -> Quang Trường
UPDATE designs SET designer_id = (SELECT id FROM users WHERE full_name ILIKE 'Quang Trường' LIMIT 1)
WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:QUANGTRUONG(\s|\])'
  AND (SELECT count(*) FROM users WHERE full_name ILIKE 'Quang Trường') = 1;

-- DANGNANA · 1 design -> Việt Na (email dangvietnana@gmail.com)
UPDATE designs SET designer_id = (SELECT id FROM users WHERE full_name ILIKE 'Việt Na' LIMIT 1)
WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:DANGNANA(\s|\])'
  AND (SELECT count(*) FROM users WHERE full_name ILIKE 'Việt Na') = 1;

-- HOTRIEU · 47 designs -> Hồ Triều (admin)
UPDATE designs SET designer_id = (SELECT id FROM users WHERE full_name ILIKE 'Hồ Triều' LIMIT 1)
WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:HOTRIEU(\s|\])'
  AND (SELECT count(*) FROM users WHERE full_name ILIKE 'Hồ Triều') = 1;

-- ══ BÁO CÁO SAU KHI CHẠY ══
-- Đã gán được cho ai / bao nhiêu design:
SELECT u.full_name, count(*) AS designs
FROM designs d JOIN users u ON u.id = d.designer_id
WHERE d.note LIKE '%[POD id:%'
GROUP BY 1 ORDER BY 2 DESC;

-- Còn bao nhiêu design legacy chưa có chủ (unassigned — admin tra qua note):
SELECT count(*) AS unassigned FROM designs WHERE note LIKE '%[POD id:%' AND designer_id IS NULL;

-- Code cũ nào còn chưa map + số lượng (để sau này bổ sung nếu người đó vào FusionOS):
SELECT substring(note FROM 'designer:([^ \]"]+)') AS legacy_code, count(*) AS designs
FROM designs
WHERE note LIKE '%[POD id:%' AND designer_id IS NULL AND note ~ 'designer:'
GROUP BY 1 ORDER BY 2 DESC;
