# Legacy POD (podstoecom) → FusionOS — Import Designs

Rebuild 29/9/2026 từ dump `dbpodapi.sql` (bản build giống hệt gói 14/9 — cùng ID, chạy đè không trùng).

## Gói gồm
| File | Vai trò |
|---|---|
| `legacy-pod-designs-import.sql.gz` | Import 123.920 designs + 192.953 files vào FusionOS. Idempotent — chạy lại không trùng. |
| `legacy-designer-mapping.sql` | Template gán designer (36 code cũ) — điền email user FusionOS rồi bỏ comment. |
| `README-legacy-import.md` | File này. |

## Bước 1 — Import designs
```bash
gunzip -c legacy-pod-designs-import.sql.gz | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
```
- **BẮT BUỘC** dùng connection string **Direct / Session (cổng 5432)** của Supabase.
  KHÔNG dùng pooler cổng 6543 (file dùng COPY + temp table, pooler sẽ lỗi).
- Chạy xong file tự in 2 số kiểm tra. Đúng là:
  - `legacy_designs = 123920`
  - `legacy_files  = 192953`
- Chạy lặp lại an toàn (INSERT 0 dòng).

## Bước 2 — Gán designer
Mở `legacy-designer-mapping.sql`: mỗi designer cũ có 1 câu UPDATE đang comment.
Thay `EMAIL_HERE` bằng email tài khoản FusionOS của người đó, bỏ `-- ` ở 2 dòng UPDATE, chạy.
Chỉ update dòng `designer_id IS NULL` nên chạy lại/chạy thiếu đều an toàn. Code chưa có tài khoản thì bỏ qua, map sau.

36 designer cũ (theo số design): KIMTHAO 15.924 · THUHUYEN 14.402 · THUTRINH 10.983 · QUYNGUYEN 9.722 · HONGPHUC 9.160 · Ngocvi 8.041 · THANHTHAO 6.319 · HOANGPHUC 5.192 · HOAIGIANG 5.125 · THIENQUANG 4.931 · HIEUMINH 4.903 · ANHTU 4.813 · HONGDIEM 4.618 · THANHVINH 3.897 · TUYETSUONG 3.576 · PHUOCDUC 2.614 · VANNGOC 2.166 · VANMANH 1.759 · DINHPHUC 1.407 · DACHUY 1.276 · MINHHIEU 1.229 · THACHTRUC 959 · LEHAN 329 · TRIPHAN 144 · HOAILINH 119 · TANLOC 115 · admin 52 · PINKDESIGN 52 · HOTRIEU 47 · undefined 26 · TUVI 7 · THANHMAI 7 · ANNGUYEN 3 · QUANGTRUONG 1 · MYHANH 1 · DANGNANA 1

## Ghi chú kỹ thuật
- File ảnh giữ nguyên URL S3 `stoecombucket` (bucket còn sống) — không copy file.
- Provenance của từng design nằm trong `note`: `[POD id:.. sku:.. type:.. status:.. designer:.. creator:.. seller:.. store:.. meta:..]` — muốn gán thêm **seller** thì làm giống mapping designer nhưng regex theo `seller:CODE`.
- Mapping: name→title (2 card trống tên → "Untitled POD design #id"), tags→mảng, is_personalized→personalize, status='listed'→listed (4.019), platform etsy 4.152/tiktok 2/'all'→NULL, points ≥1, created_at giữ nguyên.
- Attachments: 12.496 file mồ côi (card đã xoá) bị bỏ; 900 file bổ sung từ URL cấp card khi thiếu attachment cùng loại; kind chuẩn hoá (right_sleeve→sleeve_right, january→month_01, page_3→page_03, front_cover→cover_front, mockup_video→video…).
- Không migrate orders, không migrate accounts (bảng accounts cũ chứa mật khẩu plaintext).
