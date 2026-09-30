-- Legacy POD -> FusionOS: designer mapping (fill in the FusionOS user EMAIL, uncomment, run)
-- Matches the [POD ... designer:CODE ...] tag in designs.note; only rows with designer_id IS NULL are updated.
-- Safe to re-run. Codes below sorted by design count.

-- KIMTHAO: 15924 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:KIMTHAO(\s|\])';

-- THUHUYEN: 14402 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:THUHUYEN(\s|\])';

-- THUTRINH: 10983 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:THUTRINH(\s|\])';

-- QUYNGUYEN: 9722 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:QUYNGUYEN(\s|\])';

-- HONGPHUC: 9160 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:HONGPHUC(\s|\])';

-- Ngocvi: 8041 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:Ngocvi(\s|\])';

-- THANHTHAO: 6319 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:THANHTHAO(\s|\])';

-- HOANGPHUC: 5192 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:HOANGPHUC(\s|\])';

-- HOAIGIANG: 5125 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:HOAIGIANG(\s|\])';

-- THIENQUANG: 4931 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:THIENQUANG(\s|\])';

-- HIEUMINH: 4903 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:HIEUMINH(\s|\])';

-- ANHTU: 4813 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:ANHTU(\s|\])';

-- HONGDIEM: 4618 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:HONGDIEM(\s|\])';

-- THANHVINH: 3897 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:THANHVINH(\s|\])';

-- TUYETSUONG: 3576 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:TUYETSUONG(\s|\])';

-- PHUOCDUC: 2614 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:PHUOCDUC(\s|\])';

-- VANNGOC: 2166 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:VANNGOC(\s|\])';

-- VANMANH: 1759 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:VANMANH(\s|\])';

-- DINHPHUC: 1407 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:DINHPHUC(\s|\])';

-- DACHUY: 1276 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:DACHUY(\s|\])';

-- MINHHIEU: 1229 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:MINHHIEU(\s|\])';

-- THACHTRUC: 959 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:THACHTRUC(\s|\])';

-- LEHAN: 329 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:LEHAN(\s|\])';

-- TRIPHAN: 144 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:TRIPHAN(\s|\])';

-- HOAILINH: 119 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:HOAILINH(\s|\])';

-- TANLOC: 115 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:TANLOC(\s|\])';

-- admin: 52 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:admin(\s|\])';

-- PINKDESIGN: 52 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:PINKDESIGN(\s|\])';

-- HOTRIEU: 47 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:HOTRIEU(\s|\])';

-- undefined: 26 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:undefined(\s|\])';

-- TUVI: 7 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:TUVI(\s|\])';

-- THANHMAI: 7 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:THANHMAI(\s|\])';

-- ANNGUYEN: 3 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:ANNGUYEN(\s|\])';

-- QUANGTRUONG: 1 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:QUANGTRUONG(\s|\])';

-- MYHANH: 1 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:MYHANH(\s|\])';

-- DANGNANA: 1 designs
-- UPDATE designs SET designer_id = (SELECT id FROM users WHERE lower(email) = lower('EMAIL_HERE'))
--   WHERE designer_id IS NULL AND note ~ '\[POD [^\]]*designer:DANGNANA(\s|\])';

-- Check afterwards:
-- SELECT count(*) FROM designs WHERE note LIKE '%[POD id:%' AND designer_id IS NOT NULL;
