# FUSION OS — Hướng dẫn chạy thật

## 1. Chuẩn bị `.env`

Copy `.env.example` thành `.env` rồi điền thông tin thật:

```env
# Supabase — lấy ở Project Settings → Database → Connection string (chọn "Session" pooler)
DATABASE_URL="postgresql://postgres.xxxx:[MẬT_KHẨU]@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"

# Chuỗi ngẫu nhiên dài (bảo mật JWT + Extension)
INGEST_API_KEY="tự-đặt-chuỗi-ngẫu-nhiên-dài"
AUTH_SECRET="tự-đặt-chuỗi-ngẫu-nhiên-dài-khác"

# Cloudflare R2 — lấy ở R2 → Manage API Tokens
R2_ACCOUNT_ID="..."
R2_ACCESS_KEY_ID="..."
R2_SECRET_ACCESS_KEY="..."
R2_BUCKET="fusion-designs"
R2_PUBLIC_URL="https://pub-xxxx.r2.dev"

# Tuỳ chọn — cho "Generate Info By AI" ở Design Studio
ANTHROPIC_API_KEY=""
```

> Không có R2 vẫn chạy được: khi thiếu cấu hình R2, hệ thống tự lưu file vào thư mục `.uploads/` trên máy.

## 2. Cài đặt

```bash
npm install
```

## 3. Tạo bảng (chỉ chạy lần đầu, hoặc khi có thay đổi schema)

```bash
npm run db:push
```

Lệnh này đọc schema trong `src/db/schema.ts` và tạo/cập nhật bảng trên Supabase. An toàn với dữ liệu đã có (chỉ thêm cột/bảng mới).

## 4. Nạp dữ liệu demo (1 lệnh)

```bash
npm run db:seed-all
```

Tạo đầy đủ: tài khoản + quyền, seller/designer/store, ~90 đơn hàng, giao dịch, 60+ design (có ảnh), reviews. Đủ để mọi màn hình có dữ liệu thật để xem và chỉnh.

Hoặc chạy riêng từng phần:
```bash
node --env-file=.env scripts/seed-auth.mjs          # tài khoản + quyền
node --env-file=.env scripts/seed-demo.mjs           # đơn + giao dịch
node --env-file=.env scripts/seed-designs-demo.mjs   # thêm 40 design có ảnh
```

## 5. Chạy

```bash
npm run dev      # môi trường phát triển (sửa code là tự reload)
```
hoặc
```bash
npm run build && npm start   # môi trường chạy thật
```

Mở http://localhost:3000

## Tài khoản demo

| Email | Vai trò | Ghi chú |
|---|---|---|
| admin@fusion.co | Admin | Toàn quyền |
| tri@fusion.co | Seller | Chỉ thấy đơn của mình |
| ha@, lan@ | Seller | |
| anh@, quy@, quang@ | Designer | |
| linh@ | Content | Không vào được Đơn hàng |

**Mật khẩu tất cả: `fusion123`**

## Xoá sạch làm lại (nếu cần)

Trên Supabase SQL Editor:
```sql
DROP SCHEMA public CASCADE; CREATE SCHEMA public;
```
Rồi chạy lại từ bước 3 (`db:push` → `db:seed-all`).

## Ghi chú deploy

- **Vercel**: import repo, thêm các biến `.env` vào Environment Variables, deploy. `db:push` và seed chạy từ máy local (trỏ vào Supabase) trước khi deploy.
- **Extension** (kéo đơn Amazon/Etsy): sửa `INGEST_API_KEY` và URL server trong extension cho khớp `.env`.
