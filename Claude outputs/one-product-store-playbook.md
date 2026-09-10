# PLAYBOOK: ONE-PRODUCT STORE (Shopify) — theo mô hình bellypackshop.com

> Lưu hành nội bộ · 09/2026 · Đúc kết từ phân tích source bellypackshop.com (Shopify + Shrine v2.1.0)
> Chiến lược tổng: **General store (ShopBase) để TEST → winner tách sang Shopify one-product store.**
> File này là checklist dựng store Shopify khi ĐÃ CÓ winner.

---

## 0. KHI NÀO MỚI ĐƯỢC DỰNG STORE NÀY

Chỉ dựng khi mẫu đã chứng minh bằng tiền trên store test:

- ROAS ổn định TRÊN break-even qua **7–14 ngày liên tục** (không phải ăn may 2–3 đơn/hôm)
- Scale ngân sách lên mà số vẫn giữ
- Volume: đang tiêu được vài trăm $/ngày mà vẫn lời

Mẫu chưa đạt → tiếp tục test trên ShopBase, KHÔNG dựng store riêng (tốn ~1 tuần công + $170 theme + domain vô ích).

Lưu ý khi chuyển ShopBase → Shopify:
- Pixel/data KHÔNG mang theo được → chấp nhận learning phase lại vài ngày.
- Chuyển khi mẫu CÒN DƯ vòng đời, đừng đợi nó đuối mới chuyển.
- Giữ nguyên creative + audience đã thắng, chỉ đổi destination URL → biến số duy nhất thay đổi là trang đích.

---

## 1. NỀN TẢNG & THEME

| Hạng mục | Chọn | Ghi chú |
|---|---|---|
| Nền tảng | Shopify (gói Basic đủ) | Shop Pay + checkout Shopify là lợi thế conversion |
| Theme | **Shrine Pro** (~$170, shrinetheme.com, license 1 store) | Theme CRO chuyên one-product; bản bellypack dùng là Shrine v2.1.0 |
| Thay thế miễn phí | Dawn + tự dựng section | Các block so sánh/ticker/review làm thủ công được, chất lượng không thua |
| Domain | Tên theo SẢN PHẨM (kiểu bellypackshop) | Tạo cảm giác brand "phát minh ra món này" |

⚠️ MUA THEME CHÍNH CHỦ. Bellypack dùng bản export chuyền tay từ store khác
(`theme-export-shoppurrnest-com...`) + script lạ giả danh jsDelivr (`shopify.jsdeliver.cloud`) —
dấu hiệu bản crack. Bản crack = rủi ro chèn mã độc/ăn cắp data khách + không update. Không đáng để tiết kiệm $170.

---

## 2. KIẾN TRÚC STORE (điểm cốt lõi)

**Homepage = redirect thẳng về trang product:**

```html
<!-- Bellypack đặt trong theme.liquid / index template -->
<script>
  window.location.href = "/products/ten-san-pham";
</script>
```

- Khách từ ads KHÔNG BAO GIỜ đi lạc: chỉ có 1 trang, 1 quyết định mua/không.
- Cách sạch hơn redirect JS: Shopify Admin → Online Store → Preferences không có sẵn,
  dùng app redirect hoặc sửa `templates/index.json` chỉ chứa 1 section redirect;
  hoặc đơn giản: MỌI link ads đều trỏ thẳng `/products/...`, homepage để phòng hờ.
- Menu tối giản: Home / Catalog / Contact. Footer đủ 5 trang policy (bắt buộc cho ads):
  Contact Information, Privacy, Refund, Shipping, Terms of Service (+ Legal Notice nếu EU).

---

## 3. TRANG PRODUCT = LANDING PAGE (thứ tự block chuẩn Shrine)

Từ trên xuống:

1. **Announcement ticker** (chạy chữ): 3 câu — ưu đãi thật · free shipping · social proof THẬT
2. **Gallery + Buy box**: ảnh lifestyle đầu tiên, giá gạch compare-at, sao review ngay dưới title
3. **Bundle quantity breaks** (mục 4 dưới)
4. **Icon bar** 4 lợi ích (icon + 1 dòng mỗi cái)
5. **Bảng so sánh "Us vs Them"**: 4–6 dòng benefit, cột mình ✓ xanh, cột "Others" ✗
6. **Vertical ticker** FEATURE 1-5 (điểm bán chính, chữ to)
7. **Results/số liệu**: "90% khách nhận thấy..." — CHỈ dùng khi có khảo sát thật, kèm caption nguồn
8. **Testimonials 3 cột** (5 sao + quote + tên) — lấy từ review THẬT
9. **FAQ accordion** (5–7 câu: shipping, return, size, chất liệu)
10. **Sticky add-to-cart** (mobile bắt buộc)
11. Contact form + newsletter cuối trang

Cart drawer (không sang trang cart) + đủ payment badges + nút Checkout to.

---

## 4. BUNDLE & UPSELL (công thức tăng AOV của bellypack)

App: RapiBundle / Kaching Bundles / Vitals (bundle quantity breaks). Cấu trúc bellypack dùng:

| Offer | Giảm | Nhãn |
|---|---|---|
| Buy 1 | Giá chuẩn | "Standard price" |
| **Buy 2** | Save $X | **"Most Popular"** (highlight, preselect) |
| Buy 3 | Save $XX | — |

- Preselect gói giữa (Buy 2) — tăng AOV mạnh nhất.
- Upsell checkbox tick sẵn dưới bundle: "+ Shipping Protection" / "+ 30-Day Warranty"
  (2 sản phẩm ảo giá $2–5). LƯU Ý vùng xám: nếu dùng thì mô tả rõ ràng nó là gì,
  cho untick dễ dàng — tick sẵn mà mập mờ dễ ăn dispute/chargeback.
- Discount tự động qua app (Automatic Discount), không dùng mã.

---

## 5. TRUST — LÀM THẬT, KHÔNG FAKE

Bellypack fake toàn bộ (store 1 tuần tuổi — logo tên file `ChatGPT_Image_Aug_31_2026` —
mà ticker "LOVED BY 10,000+ CUSTOMERS" + "FINAL INVENTORY SALE 40%"). Chạy kiểu này:
Meta/Google quét ra là bay account, khách dispute là mất payment gateway. Thay bằng:

- Đơn thật từ giai đoạn test ShopBase → email xin review (Judge.me/Loox) NGAY từ tuần đầu
- Social proof số nhỏ nhưng thật: "500+ orders shipped" khi đủ 500
- Urgency thật: đếm tồn kho thật, deadline sale thật có kết thúc
- UGC: xin ảnh/video khách (đổi discount đơn sau) làm testimonial + creative ads

---

## 6. TECH STACK TỐI THIỂU

- Theme Shrine Pro (hoặc Dawn + custom section)
- App bundle (RapiBundle/Kaching) — quantity breaks + upsell
- App review (Judge.me free đủ)
- Currency converter (nếu bán ngoài US)
- Meta Pixel + Conversions API, GA4
- KHÔNG cài quá 5–6 app — nặng trang là tụt conversion

Số bỏ qua được: script chặn chuột phải/F12/Ctrl+U (bellypack có) — vô dụng
(`view-source:` vẫn xem được), chỉ làm khó khách muốn copy địa chỉ. Bỏ.

---

## 7. CHECKLIST DỰNG STORE (thứ tự làm)

1. ☐ Mua domain theo tên sản phẩm + tạo store Shopify
2. ☐ Cài theme (mua chính chủ) + logo/palette (2 màu chính, 1 màu accent nút)
3. ☐ Dựng trang product theo 11 block ở mục 3
4. ☐ Cài app bundle, cấu hình Buy 1/2/3 + preselect gói giữa
5. ☐ 5 trang policy + Contact (bắt buộc trước khi chạy ads)
6. ☐ Shipping profile + delivery time khớp thực tế supplier (under-promise)
7. ☐ Homepage redirect / mọi link ads trỏ thẳng product
8. ☐ Pixel + CAPI + test purchase event bằng đơn thử
9. ☐ Cài review app, import review thật từ store test (nếu nền tảng cho phép)
10. ☐ Mobile check toàn bộ (≥70% traffic là mobile): sticky ATC, tốc độ, ảnh
11. ☐ Chạy lại creative + audience thắng từ store test, budget bằng 50–70% mức cũ (pixel học lại)
12. ☐ Ngày 3–5: so CR% mới vs store test — mục tiêu one-product store PHẢI cao hơn

---

## 8. VÒNG ĐỜI & KPI

- CR mục tiêu trang product: ≥ 3% (traffic ads lạnh); dưới 1.5% sau 300 click → sửa trang trước khi đổ thêm tiền
- AOV mục tiêu: ≥ 1.5× giá 1 sản phẩm (nhờ bundle)
- Winner đuối (CTR tụt, CPA leo dần bất chấp creative mới) → vắt nốt bằng sale xả thật → treo domain
- Store test ShopBase là máy đẻ winner vĩnh viễn — mỗi winner mới = 1 store mới, máy test chỉ có 1

---

*Phân tích gốc: bellypackshop.com — Shopify, theme Shrine 2.1.0 (schema_name trong `Shopify.theme`),
theme_store_id null, homepage redirect JS, RapiBundle quantity breaks, upsell ảo, trust fake.
Học cấu trúc — không học cách làm.*
