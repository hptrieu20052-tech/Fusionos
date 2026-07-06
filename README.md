# FUSION OS — v0.1

Hệ thống quản lý ecommerce cho FUSION CO., LTD. Next.js 14 + Prisma + PostgreSQL.

## Chạy lần đầu

```bash
npm install
cp .env.example .env        # điền DATABASE_URL (Supabase/Neon/local đều được)
npm run db:push             # tạo bảng theo src/db/schema.ts (drizzle-kit)
npm run db:seed             # dữ liệu mẫu: 4 user, 2 store, 6 đơn
npm run dev                 # http://localhost:3000
```

## Đã có gì

- **/** — Dashboard đếm đơn/design/store từ DB thật
- **/orders** — Danh sách đơn, lọc theo trạng thái, tìm kiếm
- **POST /api/ingest/orders** — Endpoint nhận đơn từ Extension/Excel/webhook,
  dedup theo `UNIQUE(platform, externalId)`, xác thực bằng header `x-api-key`
- **GET /api/orders** — API danh sách đơn (lọc status/seller/q)
- **src/db/schema.ts** — 10 bảng Drizzle ORM khớp bản thiết kế schema (không cần binary như Prisma, cài là chạy)
- **extension/** — Chrome Extension MV3 skeleton: nút "⚡ Sync FUSION" trên
  Amazon Seller Central & Etsy, gửi đơn về API qua background worker

## Test API nhanh

```bash
curl -X POST http://localhost:3000/api/ingest/orders \
  -H "Content-Type: application/json" \
  -H "x-api-key: fusion-ingest-dev-key-change-me" \
  -d '{"platform":"amazon","orders":[{"externalId":"111-1234567-7654321","items":[{"productTitle":"Test Tee","qty":1}]}]}'
# → {"ok":true,"created":1,"updated":0,"failed":0}
# Gửi lại lần 2 → created:0, updated:1 (dedup hoạt động)
```

## Cài Extension (dev)

1. Chrome → `chrome://extensions` → bật Developer mode → Load unpacked → chọn thư mục `extension/`
2. Mở trang Orders của Amazon Seller Central → bấm nút "⚡ Sync FUSION"
3. Selector parse đơn trong `content-amazon.js` cần tinh chỉnh theo layout thật của tài khoản bạn

## Lộ trình tiếp theo

- [ ] Auth (NextAuth) + RBAC theo role_permissions
- [ ] Design Studio: upload presigned URL → Cloudflare R2, worker sinh thumbnail
- [ ] Push fulfillment qua API (Gearment/Printify/Merchize) + webhook tracking
- [ ] TikTok Shop OAuth + webhook đơn realtime
- [ ] Trang Tài chính từ bảng transactions

## ✅ Đã test end-to-end (05/07/2026)

Toàn bộ đã chạy thử với PostgreSQL 16 thật:
- `db:push` tạo bảng OK · `db:seed` OK
- `next build` không lỗi
- POST /api/ingest/orders: tạo đơn mới → `created:1`; gửi lại cùng đơn → `updated:1` (**dedup hoạt động**)
- Sai x-api-key → HTTP 401
- Trang /orders render dữ liệu thật từ DB

## ✅ Đã test end-to-end (05/07/2026)

Toàn bộ đã chạy thử với PostgreSQL 16 thật trong môi trường dev:
- `db:push` tạo bảng OK · `db:seed` OK · `next build` không lỗi
- POST /api/ingest/orders: đơn mới → created:1; gửi lại cùng đơn → updated:1 (dedup OK)
- Sai x-api-key → HTTP 401 · Trang /orders render dữ liệu thật từ DB

## 🔐 Auth + Phân quyền (v0.2)

**Đăng nhập:** JWT (jose, HS256) trong httpOnly cookie `fusion_session` 7 ngày, mật khẩu bcrypt.
Middleware bảo vệ toàn bộ route (trừ /login và /api/ingest): chưa login → page redirect /login, API trả 401.

**Phân quyền 2 lớp:**
1. **Ma trận role × module** (bảng `role_permissions`): mỗi ô 3 mức — 0 Ẩn · 1 Chỉ xem · 2 Toàn quyền. Admin luôn toàn quyền. Sửa realtime tại trang **/admin** (bấm ô để xoay mức, lưu thẳng DB).
2. **Giới hạn cá nhân** (bảng `user_restrictions`): `own_orders_only` (seller chỉ thấy đơn store mình), `hide_profit`, `hide_customer_info` (ẩn địa chỉ khách)…

Cả **page lẫn API** đều kiểm tra quyền — không thể lách bằng cách gọi API trực tiếp.

**Tài khoản mẫu** (mật khẩu đều là `fusion123`):
| Email | Role | Ghi chú |
|---|---|---|
| admin@fusion.co | admin | toàn quyền + trang /admin |
| tri@fusion.co | seller | own_orders_only — chỉ thấy đơn TikTok store mình |
| ha@fusion.co | seller | own_orders_only |
| anh@fusion.co | designer | xem đơn, không sửa |
| linh@fusion.co | content | bị ẩn hoàn toàn module Đơn hàng |

**Kết quả test (05-06/07/2026, chạy thật):**
- Chưa login → 307 về /login · login sai mật khẩu → 401 ✅
- Content role: page /orders hiện "🔒 Bạn không có quyền", API /api/orders → 403, menu ẩn link ✅
- Seller Trí: chỉ thấy 5 đơn TikTok của mình, không thấy đơn Amazon của Thu Hà · Admin thấy đủ 7 ✅
- Content PATCH /api/admin/permissions → 403 · Admin PATCH → ok ✅

## 🎨 Design Studio + Storage (v0.3)

**Kiến trúc upload đúng thiết kế:** browser xin presigned URL → PUT file **thẳng lên storage** (không qua server) → đăng ký metadata → sinh thumbnail.
- `src/lib/storage.ts` — driver 2 chế độ: có biến env `R2_*` → **Cloudflare R2** presigned URL; không có → lưu local disk để dev. Code gọi y hệt nhau.
- **Dedup SHA-256**: file trùng hash → tái dùng storage key + thumbnail cũ, không tốn thêm dung lượng.
- **Thumbnail pipeline (sharp)**: sinh thumb 300px + preview 1200px WebP. Test thật: file gốc 89KB → thumb **224 bytes**. Dev chạy inline qua `/api/designs/process`; production chuyển sang BullMQ worker.
- Grid `/designs` chỉ tải thumbnail, lazy loading — không bao giờ đụng file gốc.

Env cho production (điền vào .env):
```
R2_ACCOUNT_ID=...  R2_ACCESS_KEY_ID=...  R2_SECRET_ACCESS_KEY=...
R2_BUCKET=fusion-designs
R2_PUBLIC_BASE=https://cdn.yourdomain.com   # custom domain / CDN trước R2
```

## 📦 Fulfillment (v0.3)

- **/fulfillment** — bảng đơn chờ đẩy: mỗi đơn hiện các fulfiller kèm **giá vốn ước tính** từ sku_mappings (thiếu mapping thì disable), bấm 🚀 Đẩy.
- **POST /api/fulfillment/push** — kiểm tra trạng thái + địa chỉ + mapping đầy đủ; tạo `fulfillment_orders`, chuyển đơn → `created`, **tự ghi transaction base_cost (âm)** để trang Tài chính SUM là ra lợi nhuận. Có credentials thật → gọi API hãng (adapter), chưa có → simulate.
- **POST /api/webhooks/fulfillment** — nhận tracking từ fulfiller, xác thực `x-webhook-secret` theo từng hãng, cập nhật tracking + đơn → `shipped`.
- **GET /api/fulfillment/export?fulfillerId=** — xuất CSV (mở bằng Excel) đúng cột địa chỉ + fulfiller SKU cho hãng làm thủ công.
- Chống double-push: đơn đã `created` không đẩy lại được.

## ✅ Test v0.3 (chạy thật 06/07/2026)

Design Studio: tạo design → upload local driver → register (deduped:false) → process sinh thumb 224B/preview 2KB → grid trả URL thumb, HTTP 200 → upload lại cùng file: **deduped:true** ✅
Fulfillment: pending hiện Gearment ~$8.80 (đơn thiếu mapping bị disable) → push: SIM id + cost 8.8 + order `created` + transaction `-8.80` → webhook sai secret 401 / đúng secret: tracking USPS lưu, order `shipped` → CSV export đúng cột ✅
RBAC: content bị 403 cả 2 module API · designer push 403 nhưng upload design OK · double-push bị chặn 409 ✅

## 🖥️ Giao diện đầy đủ theo thiết kế Clarity (v0.5)

Toàn bộ màn hình prototype đã chuyển thành trang thật nối database:

| Trang | Nội dung |
|---|---|
| **/** Dashboard | KPI 7 ngày (đơn, doanh thu, AOV, design mới) · bar chart đơn theo ngày · cơ cấu theo nền tảng · top seller · đơn mới nhất |
| **/orders** Order Hub | Tabs trạng thái kèm số đếm · tìm kiếm · click đơn mở **drawer chi tiết**: sửa Shipping Info (PATCH), đổi trạng thái, panel đẩy fulfillment ngay trong đơn |
| **/designs** Design Studio | Grid thumbnail + tìm kiếm · modal chi tiết tabs **Mockups / Front / Back / Videos** · thêm file theo loại · đơn phát sinh & điểm review |
| **/stores** Store Management | 4 cột theo sàn (Amazon/Etsy/TikTok) · orders & revenue 30 ngày mỗi store · thêm store · **credentials không bao giờ trả về client** |
| **/stats/orders** TK Order | Ma trận seller × ngày: KPI → bar chart → xếp hạng → heatmap (đơn hoặc items) |
| **/stats/designers** TK Designer | Heatmap design/ngày + điểm chất lượng TB + đơn phát sinh 30d + **KPI tổng hợp 40/30/30** |
| **/reviews** Chấm điểm KPI | Hàng chờ (chưa chấm xếp trước) · modal 3 slider Brief/Thẩm mỹ/Kỹ thuật · Duyệt / Yêu cầu sửa / Từ chối · điểm quality tự tính |
| **/finance** Tài chính | Doanh thu/Chi phí/Lợi nhuận · chart lãi-lỗ theo ngày (xanh/đỏ) · cơ cấu chi phí · theo seller & sàn · **form ghi chi phí tay** (ads, lương, tool, sample… tự đổi dấu âm) |
| **/settings** Cài đặt | Fulfiller: endpoint/API key/webhook secret (che khi hiển thị) · bảng + form SKU mapping · hint cấu hình ingest |

Schema mới: bảng `design_reviews` + enum `review_decision` → **chạy `npm run db:push` khi pull bản này**.
Seed dữ liệu demo (93 đơn 7 ngày, 28 design, 20 review, 4 store, 3 seller):
```
node --env-file=.env scripts/seed-demo.mjs
```

## ✅ Test v0.5 (chạy thật 06/07/2026)

- 11 trang render 200 với admin · nav ẩn/hiện theo quyền
- Order detail: GET + PATCH shipping ✅ · counts theo tab đúng
- Stats orders: 3 seller × 7 ngày ✅ · Stats designers: KPI composite ✅
- Finance: byType/daily/bySeller/byPlatform ✅ · POST chi phí ads → lưu -50.00 ✅
- Review: chấm 8/9/7 + approve → lưu, quality tự tính ✅
- Stores: apiCredentials **không** xuất hiện trong response ✅
- RBAC: content 403 ở orders/finance/stats/stores (reviews 200 vì designer module) · seller own_orders_only: counts 54 vs admin 100 ✅
