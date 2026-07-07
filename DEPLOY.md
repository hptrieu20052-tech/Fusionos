# FUSION OS — Deploy lên Vercel

Stack: Next.js (Vercel) + PostgreSQL (Supabase) + Storage (Cloudflare R2).
Vercel là serverless nên **bắt buộc phải cấu hình R2** (không ghi file lên đĩa được).

---

## Bước 1 — Cấu hình R2 (Cloudflare)

1. Cloudflare Dashboard → **R2** → tạo bucket, ví dụ `fusion-designs`.
2. Bucket → **Settings** → bật **Public Access** (hoặc dùng custom domain). Ghi lại URL public dạng `https://pub-xxxx.r2.dev`.
3. R2 → **Manage API Tokens** → Create Token (quyền Object Read & Write) → lưu lại:
   - Account ID
   - Access Key ID
   - Secret Access Key
4. Bucket → **Settings → CORS Policy**, thêm (cho phép browser PUT trực tiếp):
```json
[
  {
    "AllowedOrigins": ["https://TÊN-APP.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```
> Sau khi có domain Vercel thật thì quay lại thay `TÊN-APP.vercel.app`.

## Bước 2 — Supabase (Database)

1. Project → **Settings → Database → Connection string**.
2. Chọn tab **Transaction** (pooler, port **6543**) — hợp với serverless hơn Session pooler.
3. Copy string, thay `[YOUR-PASSWORD]` bằng mật khẩu DB:
```
postgresql://postgres.xxxx:[MẬT_KHẨU]@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true
```

## Bước 3 — Tạo bảng + seed (chạy 1 lần từ máy local)

Trên máy bạn, `.env` trỏ vào Supabase (dùng port **5432 Session pooler** cho lệnh push/seed — pooler transaction 6543 không chạy được migration):

```bash
npm install
npm run db:push        # tạo bảng
npm run db:seed-all    # nạp dữ liệu demo (bỏ qua nếu đã có data thật)
```

## Bước 4 — Đưa code lên GitHub

```bash
git init
git add .
git commit -m "FUSION OS"
git branch -M main
git remote add origin https://github.com/TÊN_BẠN/fusion-os.git
git push -u origin main
```
> `.gitignore` đã loại `.env`, `node_modules`, `.uploads` — an toàn.

## Bước 5 — Deploy Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → import repo GitHub.
2. Framework tự nhận **Next.js**, giữ nguyên Build/Output mặc định.
3. **Environment Variables** — thêm tất cả (dùng port **6543** cho DATABASE_URL trên production):

| Key | Value |
|---|---|
| `DATABASE_URL` | chuỗi Supabase pooler 6543 (có `?pgbouncer=true`) |
| `AUTH_SECRET` | chuỗi ngẫu nhiên dài |
| `INGEST_API_KEY` | chuỗi ngẫu nhiên dài |
| `R2_ACCOUNT_ID` | từ R2 |
| `R2_ACCESS_KEY_ID` | từ R2 |
| `R2_SECRET_ACCESS_KEY` | từ R2 |
| `R2_BUCKET` | `fusion-designs` |
| `R2_PUBLIC_URL` | `https://pub-xxxx.r2.dev` |
| `ANTHROPIC_API_KEY` | (tuỳ chọn) |

4. **Deploy**. Vài phút sau có URL `https://tên-app.vercel.app`.
5. Quay lại **R2 CORS** (bước 1.4) thay domain thật vào `AllowedOrigins`.

## Bước 6 — Kiểm tra

- Vào URL, đăng nhập `admin@fusion.co` / `fusion123`.
- Vào **Cài đặt** đổi mật khẩu admin ngay (dữ liệu thật).
- Design Studio: thử upload 1 file → phải thấy ảnh (chứng tỏ R2 + CORS OK).

---

## Sự cố thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| Upload design không lên ảnh | R2 CORS chưa đúng domain | Sửa AllowedOrigins đúng URL Vercel |
| `too many connections` | Dùng port 5432 trên Vercel | Đổi DATABASE_URL sang pooler 6543 |
| 500 ở API | Thiếu env | Kiểm tra đủ biến trong Vercel Settings |
| Timeout khi tạo thumbnail | File quá lớn | Đã set maxDuration 60s; nếu cần tăng ở plan Pro |

## Sau này cập nhật code

`git push` lên GitHub → Vercel tự build & deploy lại. Nếu đổi schema, chạy `npm run db:push` từ local trước.

---

## Hiệu năng với thư viện design lớn

Code đã tối ưu sẵn cho quy mô lớn (đã test thực tế với **200.000 design**):

| Thao tác | Thời gian |
|---|---|
| Mở trang Design Studio | ~85ms |
| Chuyển trang bất kỳ | ~18ms |
| Lọc theo seller/designer | ~17ms |
| Tìm theo tên | ~6ms |

**Đã áp dụng:**
- Index cho mọi cột lọc/sắp xếp của designs (created_at, seller, platform, listed).
- Extension `pg_trgm` cho tìm theo tên bằng ILIKE (nhanh cả khi bảng lớn).
- Đếm tổng số design bằng ước lượng thống kê thay vì `count(*)` toàn bảng (38ms → 0.03ms).
- Phân trang server-side 24/trang — không tải hết về client.

**BẮT BUỘC trước khi `db:push`:** chạy `scripts/enable-extensions.sql` trên Supabase SQL Editor (bật pg_trgm), nếu không index tìm kiếm sẽ báo lỗi khi tạo.

**Khi vượt ~500K design** (tương lai xa): cân nhắc thêm Meilisearch cho tìm kiếm full-text, và chuyển ảnh cũ >6 tháng sang R2 cold storage. Chưa cần bây giờ.
