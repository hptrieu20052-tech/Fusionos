import {
  pgTable, pgEnum, uuid, text, integer, bigint, boolean, numeric,
  timestamp, date, jsonb, serial, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------- ENUMS ----------
export const roleEnum = pgEnum("user_role", ["admin", "seller", "designer", "support", "content", "hiring"]);
export const userStatusEnum = pgEnum("user_status", ["active", "pending", "leave", "disabled"]);
export const marketplaceEnum = pgEnum("marketplace", ["tiktok", "amazon", "etsy", "shopify", "shopbase", "other"]);
export const connectMethodEnum = pgEnum("connect_method", ["api", "extension", "excel"]);
export const storeStatusEnum = pgEnum("store_status", ["active", "warning", "suspended", "pending"]);
export const orderStatusEnum = pgEnum("order_status", [
  "new", "created", "in_production", "shipped", "delivered", "completed", "cancel", "has_issues", "out_of_stock", "trash",
]);
export const orderSourceEnum = pgEnum("order_source", ["api", "extension", "excel", "manual"]);
export const fileKindEnum = pgEnum("file_kind", ["mockup", "design_front", "design_back", "video"]);
export const fileTierEnum = pgEnum("file_tier", ["hot", "cold"]);
export const processingEnum = pgEnum("processing_state", ["uploaded", "processing", "ready", "failed"]);
export const ffOrderStatusEnum = pgEnum("ff_order_status", [
  "pending", "pushed", "in_production", "shipped", "delivered", "error", "cancelled",
]);
export const txTypeEnum = pgEnum("tx_type", [
  "revenue", "base_cost", "shipping", "platform_fee", "ads", "sample", "salary", "tool", "refund", "other",
]);

// ---------- USERS ----------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull(),
  team: text("team"),
  phone: text("phone"),
  gender: text("gender"),
  dateOfBirth: date("date_of_birth"),
  startedAt: date("started_at"),        // ngày bắt đầu làm việc
  contractKey: text("contract_key"),    // file hợp đồng trên R2 (docx/pdf)
  avatarKey: text("avatar_key"),
  telegramChatId: text("telegram_chat_id"), // chat riêng với bot — designer nhận đơn seller gửi qua
  status: userStatusEnum("status").notNull().default("pending"),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- STORES ----------
export const stores = pgTable("stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  marketplace: marketplaceEnum("marketplace").notNull(),
  sellerId: uuid("seller_id").references(() => users.id),
  connectMethod: connectMethodEnum("connect_method").notNull(),
  storeUrl: text("store_url"),
  status: storeStatusEnum("status").notNull().default("pending"),
  health: jsonb("health").notNull().default({}),
  apiCredentials: jsonb("api_credentials"),
  // Token cho Extension đẩy đơn về (Bearer). Mỗi store 1 token riêng.
  ingestToken: text("ingest_token"),
  note: text("note"),
  // Tiền tệ shop + tỉ giá quy đổi sang USD (fx_rate = số đơn vị tiền này / 1 USD; VND ≈ 25400).
  currency: text("currency").notNull().default("USD"),
  fxRate: numeric("fx_rate", { precision: 14, scale: 4 }).notNull().default("1"),
  // % phí sàn ƯỚC TÍNH cho shop này (Etsy & TikTok mặc định 6.5). Sàn không trả phí theo đơn
  // qua API — chỉ có khi quyết toán — nên đơn mới về tính phí = total × fee_rate%.
  feeRate: numeric("fee_rate", { precision: 6, scale: 3 }).notNull().default("6.5"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_stores_seller").on(t.sellerId)]);

// ---------- ORDERS ----------
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").notNull(),
  platform: marketplaceEnum("platform").notNull(),
  storeId: uuid("store_id").references(() => stores.id),
  // Chủ shop HIỆN TẠI — dùng cho phân quyền (seller scope "own"). Bàn giao shop sẽ ghi đè cột này.
  sellerId: uuid("seller_id").references(() => users.id),
  // Chủ shop TẠI THỜI ĐIỂM đơn về — ghi 1 lần lúc INSERT (trigger trg_seller_at_order),
  // KHÔNG đổi khi bàn giao. Mọi báo cáo doanh số/KPI group theo cột này để công của seller
  // cũ không nhảy sang seller mới, và seller mới không bị cộng trùng. Xem MIGRATION_seller_at_order.sql.
  sellerAtOrder: uuid("seller_at_order").references(() => users.id),
  status: orderStatusEnum("status").notNull().default("new"),
  platformStatus: text("platform_status"),
  source: orderSourceEnum("source").notNull(),
  buyerFirst: text("buyer_first"),
  buyerLast: text("buyer_last"),
  addr1: text("addr1"),
  addr2: text("addr2"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  country: text("country").notNull().default("United States"),
  // Địa chỉ đầy đủ do SÀN tự ghép (Etsy formatted_address = nội dung nút Copy address). Nguồn chuẩn để đối chiếu,
  // bảo đảm không thiếu dòng nào (Unit/Apt/tòa nhà…), đúng mọi quốc gia. Field tách rời vẫn dùng cho API nhà in.
  formattedAddress: text("formatted_address"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  platformFee: numeric("platform_fee", { precision: 12, scale: 2 }).notNull().default("0"),
  // true = platform_fee đang là số ƯỚC TÍNH theo % của shop → UI ghi rõ "Fee (est.)".
  // false = phí THẬT (import file Payments của Etsy, hoặc nhập tay).
  feeEstimated: boolean("fee_estimated").notNull().default(false),
  currency: text("currency").notNull().default("USD"),
  orderLabel: text("order_label"),
  note: text("note"),                 // note NỘI BỘ (staff tự ghi)
  buyerNote: text("buyer_note"),      // note của KHÁCH (message from buyer trên Etsy) — hiện nền cam, read-only
  designerSentTo: text("designer_sent_to"),   // đã gửi đơn cho designer nào (tên) qua Telegram
  designerSentAt: timestamp("designer_sent_at", { withTimezone: true }),
  // TikTok: "TIKTOK" (Fulfilled by TikTok — get label để đẩy nhà in) | "SELLER" (mình tự ship). Null = không rõ / sàn khác.
  shippingType: text("shipping_type"),
  // Mức vận chuyển KHÁCH CHỌN lúc checkout (vd "Express", "Standard") — từ shipping_lines của Shopify/Etsy.
  // Để người fulfill biết đơn nào phải ship nhanh. Cần MIGRATION_v229. null = không rõ / free standard.
  shippingMethod: text("shipping_method"),
  // UTM lấy từ landing_site của Shopify (trang khách vào ĐẦU TIÊN) — để quy đơn về đúng video × kênh.
  // utm_campaign = "video_<videoCode>", utm_source = kênh phân phối (tiktok/reels/…). CHỈ có với đơn về
  // SAU khi link phân phối bắt đầu được dùng; đơn cũ để trống. Xem MIGRATION_v236_order_utm.sql.
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  // Label TikTok Shipping đã lấy về + lưu R2: [{ packageId, trackingNumber, key, url, fetchedAt }]. Gửi link cho supplier.
  tiktokLabels: jsonb("tiktok_labels"),
  // Thời điểm đã Arrange (Create Package) qua API — khoá chống arrange 2 lần (tốn tiền). null = chưa arrange.
  tiktokArrangedAt: timestamp("tiktok_arranged_at", { withTimezone: true }),
  orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_orders_platform_external").on(t.platform, t.externalId),
  index("idx_orders_seller_date").on(t.sellerId, t.orderedAt),
  index("idx_orders_seller_at_date").on(t.sellerAtOrder, t.orderedAt),
  index("idx_orders_status").on(t.status),
  index("idx_orders_utm_campaign").on(t.utmCampaign),
]);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productTitle: text("product_title").notNull(),
  internalSku: text("internal_sku"),
  qty: integer("qty").notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
  designId: uuid("design_id").references(() => designs.id),
  specialPrint: boolean("special_print").notNull().default(false),
  personalization: text("personalization"),
  variant: text("variant"),
  imageUrl: text("image_url"),
  productUrl: text("product_url"),
  etsyListingId: text("etsy_listing_id"),
  mockupKey: text("mockup_key"),
  buyerFiles: jsonb("buyer_files"), // ảnh khách upload trên Etsy: [{name,url}]
}, (t) => [
  index("idx_items_order").on(t.orderId),
  index("idx_items_design").on(t.designId),
  index("idx_items_sku").on(t.internalSku),
]);

// ---------- DESIGNS ----------
export const designs = pgTable("designs", {
  id: uuid("id").primaryKey().defaultRandom(),
  skuCode: serial("sku_code").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  sellerId: uuid("seller_id").references(() => users.id),
  designerId: uuid("designer_id").references(() => users.id),
  creatorId: uuid("creator_id").references(() => users.id),
  storeId: uuid("store_id").references(() => stores.id),
  platform: marketplaceEnum("platform"),
  points: integer("points").notNull().default(1),
  tags: text("tags").array().notNull().default([]),
  personalize: boolean("personalize").notNull().default(false),
  personalization: text("personalization"),
  productLink: text("product_link"),
  note: text("note"),
  listed: boolean("listed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_designs_sku").on(t.skuCode),
  index("idx_designs_designer").on(t.designerId, t.createdAt),
  // Index cho thư viện design lớn: sort mặc định + filter theo seller/platform
  index("idx_designs_created").on(t.createdAt),
  index("idx_designs_seller_created").on(t.sellerId, t.createdAt),
  index("idx_designs_platform_created").on(t.platform, t.createdAt),
  index("idx_designs_listed").on(t.listed),
  // Tìm theo tên: trigram để ILIKE nhanh (cần extension pg_trgm)
  index("idx_designs_title_trgm").using("gin", sql`${t.title} gin_trgm_ops`),
]);

export const designFiles = pgTable("design_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  designId: uuid("design_id").notNull().references(() => designs.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // mặt in: design_front/back, sleeve_left/right, cover_front/back, month_01..12, mockup, video (text để linh hoạt theo sản phẩm)
  filename: text("filename"),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  storageKey: text("storage_key").notNull(),
  thumbKey: text("thumb_key"),
  previewKey: text("preview_key"),
  sha256: text("sha256").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  width: integer("width"),
  height: integer("height"),
  tier: fileTierEnum("tier").notNull().default("hot"),
  processingStatus: processingEnum("processing_status").notNull().default("uploaded"),
  processAttempts: smallint("process_attempts").notNull().default(0),
  processError: text("process_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_files_design").on(t.designId),
  index("idx_files_sha").on(t.sha256),
]);

// Sản phẩm TikTok kéo về từ Product API (Manage Products). Mỗi (store, tiktokProductId) = 1 dòng.
export const tiktokProducts = pgTable("tiktok_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull(),
  tiktokProductId: text("tiktok_product_id").notNull(),
  title: text("title"),
  status: text("status"),
  mainImageUrl: text("main_image_url"),
  categoryId: text("category_id"),
  categoryName: text("category_name"),
  sellerSku: text("seller_sku"),
  priceMin: numeric("price_min", { precision: 12, scale: 2 }),
  ttCreateTime: timestamp("tt_create_time", { withTimezone: true }),
  ttUpdateTime: timestamp("tt_update_time", { withTimezone: true }),
  raw: jsonb("raw"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
}, (t) => ({ uqTtProduct: uniqueIndex("uq_tt_product").on(t.storeId, t.tiktokProductId) }));

// Listing ETSY import từ CSV export chính chủ của Etsy (Manage Products Etsy).
// KHÔNG dùng API Etsy — nguồn duy nhất là file CSV seller tự tải về. Mỗi (store, title) = 1 dòng
// (CSV Etsy không có listing id nên dedupe theo title trong cùng store; import lại = cập nhật đè).
export const etsyProducts = pgTable("etsy_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  price: numeric("price", { precision: 12, scale: 2 }),
  currency: text("currency").default("USD"),
  quantity: integer("quantity"),
  tags: text("tags"),
  materials: text("materials"),
  images: jsonb("images").notNull().default([]),         // string[] — link ảnh Etsy CDN
  variations: jsonb("variations").notNull().default([]), // [{ name, values: string[] }]
  // Giá theo GIÁ TRỊ biến thể (thường là size): { "8x8": "39.95", "11x8.5": "49.95" }.
  // Export Shopify: giá mỗi variant = variantPrices[value] ?? price gốc. Nhập qua Bulk Price / Edit.
  variantPrices: jsonb("variant_prices").notNull().default({}),
  sku: text("sku"),
  status: text("status").notNull().default("active"),
  // v142 · Custom options của listing (mảng PQ, xem src/lib/personalization.ts).
  // null = chưa đặt → Push Shopify không ghi metafield fusion.options.
  personalization: jsonb("personalization"),
  // AI tối ưu SEO Shopify (title ngắn + tag chuẩn) — KHÔNG đè title gốc Etsy (dùng dedupe).
  shopifyTitle: text("shopify_title"),
  shopifyTags: text("shopify_tags"),
  shopifyDesc: text("shopify_desc"),
  // GID sản phẩm trên Shopify sau khi Push (gid://shopify/Product/...). Có = đã đẩy → lần sau cập nhật, không tạo trùng.
  shopifyProductId: text("shopify_product_id"),
  importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => ({ idxEtsyProductsStore: index("idx_etsy_products_store").on(t.storeId) }));

// ---------- SHOPIFY PRODUCTS (Manage Products Shopify — two-way sync qua GraphQL) ----------
// Bản sao sản phẩm Shopify để sửa trong FUSION rồi Push ngược. Sync = kéo về; dirty = có sửa chưa đẩy.
export const shopifyProducts = pgTable("shopify_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull(),          // store Shopify (marketplace=shopify)
  shopifyProductId: text("shopify_product_id").notNull(), // GID gid://shopify/Product/...
  handle: text("handle"),
  title: text("title").notNull(),
  bodyHtml: text("body_html"),                  // mô tả (descriptionHtml)
  vendor: text("vendor"),
  productType: text("product_type"),
  tags: text("tags"),                           // "a, b, c"
  status: text("status").notNull().default("DRAFT"), // ACTIVE / DRAFT / ARCHIVED
  seoTitle: text("seo_title"),                  // SEO Page title (≤60) — hiện trên Google
  seoDescription: text("seo_description"),      // SEO Meta description (≤160)
  category: jsonb("category"),                  // { id, name } — Shopify taxonomy (để filter)
  collections: jsonb("collections").notNull().default([]), // [{ id, title }] — collections chứa sản phẩm (để filter)
  // options: [{ name, position, values: string[] }]
  options: jsonb("options").notNull().default([]),
  // variants: [{ id(GID), title, selectedOptions:[{name,value}], price, compareAtPrice, sku, inventoryItemId, inventoryQty, barcode }]
  variants: jsonb("variants").notNull().default([]),
  // images: [{ id(GID), src, altText, position }]
  images: jsonb("images").notNull().default([]),
  onlineStoreUrl: text("online_store_url"),
  totalInventory: integer("total_inventory"),
  // Template FUSION gán cho listing này — nguồn facts cho AI Optimize + 3 tab mô tả.
  // null = tự khớp theo Product type (fallback), gán tay = luôn dùng template này.
  templateId: uuid("template_id"),
  // ---- Custom options — bộ ô cá nhân hoá RIÊNG của listing này (v141) ----
  // [{ type:"text"|"dropdown"|"upload", label, instructions, required, maxChars, options[], maxFiles }]
  // NULL  = listing chưa đặt riêng ⇒ Push personalization lấy bộ của TEMPLATE (như trước).
  // Mảng  = listing tự quyết (kể cả mảng rỗng = cố tình không có ô nào) ⇒ Push template fields
  //         KHÔNG ghi đè nữa. Đây là đường chính khi mỗi listing custom một kiểu.
  // Cần MIGRATION_v141_product_personalization.sql
  personalization: jsonb("personalization"),
  // v172 · Listing Etsy gốc (nếu bản ghi này được STAGE từ Manage Products · Etsy).
  // Flow mới: Etsy → bản nháp ở đây (shopify_product_id = '') → hoàn thiện → Push mới TẠO trên Shopify.
  // Cần MIGRATION_v172_etsy_staging.sql
  // v209 · Video hiển thị trên listing này. MỖI LISTING ĐÚNG 1 VIDEO (một video dùng lại được cho
  // nhiều listing, nhưng một listing chỉ hiện một cái). Cần MIGRATION_v209_listing_video.sql
  videoId: uuid("video_id"),
  videoMediaId: text("video_media_id"),            // GID media video trên Shopify của RIÊNG listing này
  videoPushedAt: timestamp("video_pushed_at", { withTimezone: true }),
  etsyProductId: uuid("etsy_product_id"),
  // v177 · Policy & Trademark scan (src/lib/policy-scan.ts) — lưới an toàn cửa Shopify.
  // risk: clean/medium/high (NULL = chưa quét) · hits: [{term, field, severity}]
  // HIGH bị CHẶN ở nút Push. Cần MIGRATION_v177_policy_scan.sql
  policyRisk: text("policy_risk"),
  policyHits: jsonb("policy_hits"),
  policyCheckedAt: timestamp("policy_checked_at", { withTimezone: true }),
  // ---- Google supplemental feed — CHỈ nằm trong FUSION OS, KHÔNG BAO GIỜ push lên Shopify ----
  // Merchant Center cho description tới 5000 ký tự, nhưng feed đang lấy seo_description (≤155,
  // vì ô đó là dòng snippet trên Google Search, dài hơn là bị cắt). Hai field dưới đây để xuất
  // file feed phụ ghi đè title/description mà không đụng một chữ nào trên listing.
  feedTitle: text("feed_title"),                  // ≤150 ký tự, KHÔNG dính đuôi variant 8"x8" / Matte
  feedDescription: text("feed_description"),      // 800-1200 ký tự — chỗ chứa từ khoá thật để match query
  feedAt: timestamp("feed_at", { withTimezone: true }), // lần cuối AI viết 2 field trên
  dirty: boolean("dirty").notNull().default(false), // có chỉnh sửa local chưa Push
  // Lần cuối AI Optimize viết lại listing này. null = CHƯA chạy AI bao giờ.
  // Dùng cho cột "AI" + filter "Not optimized yet" — khỏi chạy lại (và trả tiền lại) con đã xong.
  aiAt: timestamp("ai_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
  pushedAt: timestamp("pushed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  idxShopifyProductsStore: index("idx_shopify_products_store").on(t.storeId),
  idxShopifyProductsGid: index("idx_shopify_products_gid").on(t.shopifyProductId),
}));

// v374 · ShopBase products (ĐỘC LẬP với Shopify). ShopBase REST clone Shopify nên shape gần y hệt,
// nhưng id là SỐ (REST) không phải GID, và push/sync đi qua REST (src/lib/shopbase-products.ts),
// KHÔNG dùng GraphQL. Một bảng riêng để hệ Shopify (GraphQL push, video, Amazon staging) không dính.
export const shopbaseProducts = pgTable("shopbase_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull(),                     // store ShopBase (marketplace=shopbase)
  shopbaseProductId: text("shopbase_product_id").notNull(), // id SỐ của ShopBase REST
  handle: text("handle"),
  title: text("title").notNull(),
  bodyHtml: text("body_html"),
  vendor: text("vendor"),
  productType: text("product_type"),
  tags: text("tags"),
  status: text("status").notNull().default("DRAFT"),      // ACTIVE / DRAFT / ARCHIVED
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  collections: jsonb("collections").notNull().default([]), // [{ id, title }]
  options: jsonb("options").notNull().default([]),         // [{ name, position, values[] }]
  variants: jsonb("variants").notNull().default([]),       // [{ id, title, price, compareAtPrice, sku, barcode, inventoryQty, selectedOptions }]
  images: jsonb("images").notNull().default([]),           // [{ id, src, altText, position }]
  onlineStoreUrl: text("online_store_url"),
  totalInventory: integer("total_inventory"),
  dirty: boolean("dirty").notNull().default(false),        // có sửa local chưa push
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
  pushedAt: timestamp("pushed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  idxShopbaseProductsStore: index("idx_shopbase_products_store").on(t.storeId),
  idxShopbaseProductsPid: index("idx_shopbase_products_pid").on(t.shopbaseProductId),
}));

// ---------- AMAZON TEMPLATES (v286 · mỗi LOẠI sản phẩm 1 template customization Amazon) ----------
// config = cấu trúc file "Add product customizations in bulk" của Amazon, parse từ master .xlsx:
//   { headerRows: string[3][66]  — 3 dòng header GIỮ NGUYÊN (dòng 1 chứa ID template Amazon của account),
//     defaults:   string[66]     — bộ giá trị mẫu cho 1 SKU (label/instructions/required... của 6 field),
//     skuCol: 0, previewImageCol: 3, skuSuffixes: ["8X8-AMZ","11X-AMZ"], sheetName: "Template" }
// Export: mỗi child SKU 1 dòng = defaults, thay cột skuCol = SKU, previewImageCol = ảnh bìa sách.
// Khớp sản phẩm: gán tay (shopify_products.amazon_template_id) → khớp Product type → template duy nhất.
export const amazonTemplates = pgTable("amazon_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Khớp theo Product type của shopify_products (case-insensitive). null = không tự khớp, chỉ gán tay.
  productType: text("product_type"),
  config: jsonb("config").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ---------- AMAZON SP-API CONFIG (v306) ----------
// KHÔNG còn bảng singleton amazon_api_config. Khóa SP-API (LWA client id/secret/refresh_token,
// seller id, region, marketplaceId) nằm trong stores.api_credentials.spapi của store Amazon
// (marketplace='amazon') — mỗi tài khoản Amazon 1 store, sẵn sàng đa-tài-khoản. Xem src/lib/amazon-sp-api.ts.

// ---------- AMAZON PRODUCTS (v286 · Manage Products Amazon — bản STAGE riêng, như flow Etsy → Shopify) ----------
// "Push to Amazon" ở Manage Products Shopify tạo 1 bản ghi ở đây (badge AMZ bên Shopify = đã đẩy).
// Nội dung Amazon (title 150-200 + 5 bullets + description) sống Ở ĐÂY, AI gen Ở ĐÂY —
// listing mỗi sàn một nhà, không rối nhau. Nguồn (ảnh, mô tả gốc, SKU, giá) đọc JOIN từ
// shopify_products qua shopifyProductId lúc cần, không snapshot để khỏi lệch dữ liệu.
export const amazonProducts = pgTable("amazon_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull(),                    // store nguồn — để scope seller như mọi bảng khác
  shopifyProductId: uuid("shopify_product_id"),           // shopify_products.id (bản ghi local) — nguồn chính
  etsyProductId: uuid("etsy_product_id"),                 // etsy_products.id nếu đẩy thẳng từ Etsy (sau này)
  title: text("title"),                                   // Amazon title 150-200 ký tự (AI/gõ tay)
  bullets: jsonb("bullets"),                              // string[5] — About this item
  description: text("description"),                       // plain text 900-1500 ký tự
  aiAt: timestamp("ai_at", { withTimezone: true }),       // lần cuối AI viết bộ copy
  amazonTemplateId: uuid("amazon_template_id"),           // gán tay template customization (null = khớp Product type)
  // v297 · Bộ ảnh RIÊNG cho Amazon (string[] URL). null = dùng ảnh Shopify nguồn.
  // Đây là chỗ thay ảnh main nền trắng cho Amazon mà không đụng listing Shopify.
  images: jsonb("images"),
  // v313 · Override giá/variant RIÊNG cho listing này ([{suffix,label,price}]). null = dùng variations của template.
  // Cho phép 1 listing giá khác / size khác template mà không đụng các listing khác. Cần MIGRATION_v313.
  variations: jsonb("variations"),
  // v315 · Product IMPORT thẳng từ Amazon (list tay, không có nguồn Shopify): lưu SKU root + product type
  // ngay trên bản ghi này (thay vì suy ra từ shopify_products). null = product bình thường có nguồn Shopify.
  manualSku: text("manual_sku"),
  manualType: text("manual_type"),
  // v370 · Override SKU ROOT cho listing này (đổi cả parent {root}-PARENT-AMZ + child {root}-{suffix}).
  // Dùng khi SKU cũ bị kẹt "ghost" trên Amazon (mã 8603) → đặt root MỚI để tạo family sạch. null = dùng root suy từ variant Shopify.
  skuRoot: text("sku_root"),
  status: text("status").notNull().default("DRAFT"),      // DRAFT → EXPORTED → LIVE
  asin: text("asin"),                                     // ASIN parent — điền khi listing đã lên Amazon
  // v349 · map {sku: asin} cho parent + TỪNG size con (Sync kéo về) → UI click SKU mở link Amazon. Cần MIGRATION_v349.
  skuAsins: jsonb("sku_asins"),
  exportedAt: timestamp("exported_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  idxAmazonProductsStore: index("idx_amazon_products_store").on(t.storeId),
  idxAmazonProductsShopify: index("idx_amazon_products_shopify").on(t.shopifyProductId),
}));

// ---------- SHOPIFY VARIANT TEMPLATES (preset: options + giá theo tổ hợp + collection/tags/status/kênh) ----------
// Dựng 1 lần, áp cho nhiều sản phẩm: lúc Push Etsy→Shopify, và bulk-edit listing Shopify đã có (productSet).
export const shopifyTemplates = pgTable("shopify_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull(),          // template gắn với 1 store Shopify (collection/kênh theo store)
  name: text("name").notNull(),
  // Ảnh mẫu để nhận diện template trong danh sách (tránh click nhầm). URL http(s) — ảnh Shopify CDN / R2 /
  // link ảnh nhà in. Tự điền khi tạo "From Shopify product"; template Blank thì dán URL tay. Cần MIGRATION_v214.
  thumbUrl: text("thumb_url"),
  // options: [{ name, values: string[] }]  (vd Size:[8x8,10x10], Paper:[Glossy,Matte]) — tối đa 3
  options: jsonb("options").notNull().default([]),
  // variants: [{ options: {OptionName:value,...}, price, compareAtPrice?, sku? }] — giá theo TỪNG tổ hợp
  variants: jsonb("variants").notNull().default([]),
  collectionIds: jsonb("collection_ids").notNull().default([]), // gid://shopify/Collection/...
  publicationIds: jsonb("publication_ids").notNull().default([]), // sales channels (gid://shopify/Publication/...)
  status: text("status").notNull().default("DRAFT"), // ACTIVE / DRAFT / ARCHIVED
  productType: text("product_type"),            // vd "Personalized"
  vendor: text("vendor"),                       // vd "Talewix"
  themeTemplate: text("theme_template"),        // templateSuffix (Theme template, "" = Default product)
  // category: { id: gid://shopify/TaxonomyCategory/..., name } — Shopify Standard Product Taxonomy
  category: jsonb("category"),
  // categoryMetafields: [{ namespace, key, type, value, label, valueLabel }] — Book cover type/Genre/Language/Target audience
  categoryMetafields: jsonb("category_metafields").notNull().default([]),
  // ---- Personalization — ô khách tự điền trên trang sản phẩm Shopify (mô hình giống Etsy) ----
  // [{ type:"text"|"dropdown"|"upload", label, instructions, required, maxChars, options[], maxFiles }]
  // Tối đa 5 câu/template, tối đa 1 câu kiểu upload — đúng giới hạn Etsy đang áp cho seller.
  // "Push personalization" trong Manage Products ghi mảng này lên listing thành metafield
  // fusion.options (json); snippet Liquid đọc ra, render thành line item properties.
  // Cần MIGRATION_personalization.sql
  personalization: jsonb("personalization").notNull().default([]),
  // Nội dung chuẩn của loại sản phẩm — nguồn sự thật cho AI Optimize + 3 tab mô tả (Description / Product Details / Shipping)
  baseDescription: text("base_description"),   // thông tin gốc sản phẩm (chất liệu, cá nhân hoá thế nào, in ở đâu…)
  productDetails: text("product_details"),     // bullet specs — mỗi dòng 1 gạch đầu dòng
  shippingInfo: text("shipping_info"),         // nội dung tab Shipping (processing/shipping time, cost, tracking)
  // ---- Estimated delivery — widget "You'll receive your package between X - Y" trên trang sản phẩm ----
  // Số NGÀY LÀM VIỆC (widget tự bỏ T7/CN). Đặt theo Product type ⇒ mỗi loại hàng có timeline riêng.
  // Bấm "Push delivery" trong Manage Products → ghi metafield fusion.delivery (JSON) lên từng listing Shopify.
  // null = widget dùng số mặc định của nó.
  shipProcMin: integer("ship_proc_min"),        // xử lý/sản xuất tối thiểu (vd 1)
  shipProcMax: integer("ship_proc_max"),        // xử lý/sản xuất tối đa (vd 3)
  shipUsMin: integer("ship_us_min"),            // giao trong US tối thiểu (vd 4)
  shipUsMax: integer("ship_us_max"),            // giao trong US tối đa (vd 8)
  shipIntlMin: integer("ship_intl_min"),        // giao quốc tế tối thiểu (vd 10)
  shipIntlMax: integer("ship_intl_max"),        // giao quốc tế tối đa (vd 30)
  shipCutoffHour: integer("ship_cutoff_hour"),  // giờ chốt đơn 0-23 (vd 14 = đặt sau 2h chiều tính từ hôm sau)
  // Số ngày ship riêng cho từng nước: { "ca":[6,12], "gb":[7,14], "au":[8,16], "de":[7,14] }
  // Nước không có trong map ⇒ dùng ship_intl_* (Rest of world). Cần MIGRATION_shopify_delivery_countries.sql
  shipCountries: jsonb("ship_countries").$type<Record<string, [number, number]>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  idxShopifyTemplatesStore: index("idx_shopify_templates_store").on(t.storeId),
}));

// ---------- FULFILLMENT ----------
export const fulfillers = pgTable("fulfillers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  method: text("method").notNull(), // api | excel
  apiEndpoint: text("api_endpoint"),
  credentials: jsonb("credentials"),
  webhookSecret: text("webhook_secret"),
  logoKey: text("logo_key"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  autoPush: boolean("auto_push").notNull().default(false),
  safeMode: boolean("safe_mode").notNull().default(false),
  // Nhà DROPSHIP (Compassup...) — KHÔNG cần gán design mới đẩy được đơn
  nonPod: boolean("non_pod").notNull().default(false),
  status: text("status").notNull().default("connected"),
});

export const skuMappings = pgTable("sku_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  internalSku: text("internal_sku").notNull(),
  productType: text("product_type"),
  variant: text("variant"),
  fulfillerId: uuid("fulfiller_id").notNull().references(() => fulfillers.id),
  fulfillerSku: text("fulfiller_sku").notNull(),
  fulfillerProduct: text("fulfiller_product"),
  fulfillerProductId: text("fulfiller_product_id"),
  // Printify "recipe": in SKU nội bộ này lên blueprint/provider/variant nào
  pfBlueprintId: integer("pf_blueprint_id"),
  pfProviderId: integer("pf_provider_id"),
  pfVariantId: integer("pf_variant_id"),
  priceTier: text("price_tier"),
  baseCost: numeric("base_cost", { precision: 10, scale: 2 }).notNull(),
  shipCost: numeric("ship_cost", { precision: 10, scale: 2 }).notNull().default("0"),
  active: boolean("active").notNull().default(true),
  // Ghim: chỉ SP được ghim mới hiện mặc định trong form tạo đơn (tránh nhồi cả nghìn SKU)
  pinned: boolean("pinned").notNull().default(false),
  // Dữ liệu riêng nhà in không có cột chuyên biệt (Compassup: link, sup_site, seller_id, weight, sku_id, custom)
  extraJson: jsonb("extra_json"),
}, (t) => [
  uniqueIndex("uq_map_sku_ff").on(t.internalSku, t.fulfillerId),
  index("idx_map_sku").on(t.internalSku),
  index("idx_map_pinned").on(t.fulfillerId, t.pinned),
]);

export const fulfillmentOrders = pgTable("fulfillment_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  fulfillerId: uuid("fulfiller_id").notNull().references(() => fulfillers.id),
  externalFfId: text("external_ff_id"),
  status: ffOrderStatusEnum("status").notNull().default("pending"),
  cost: numeric("cost", { precision: 12, scale: 2 }),
  baseCost: numeric("base_cost", { precision: 12, scale: 2 }),
  shipCost: numeric("ship_cost", { precision: 12, scale: 2 }),
  extraFee: numeric("extra_fee", { precision: 12, scale: 2 }).default("0"),
  // Dòng đã đẩy: [{ product, variant, sku, qty }] — để hiện lại Variant/Qty của mỗi lần đẩy
  lines: jsonb("lines"),
  // Chi phí theo từng event webhook (idempotent): { base, ship, fees: { [eventId]: amount } }
  costEvents: jsonb("cost_events").notNull().default({}),
  trackingNumber: text("tracking_number"),
  trackingCarrier: text("tracking_carrier"),
  trackingUrl: text("tracking_url"),
  supplierOrderUrl: text("supplier_order_url"),
  pushedAt: timestamp("pushed_at", { withTimezone: true }),
  trackingSyncedAt: timestamp("tracking_synced_at", { withTimezone: true }),
  // Thời điểm đã đẩy tracking NGƯỢC lên Etsy qua API (createReceiptShipment). null = chưa đẩy.
  etsyTrackingPushedAt: timestamp("etsy_tracking_pushed_at", { withTimezone: true }),
  // Thời điểm đã đẩy tracking lên TikTok (Seller Shipping, ship package). null = chưa đẩy.
  tiktokTrackingPushedAt: timestamp("tiktok_tracking_pushed_at", { withTimezone: true }),
  // Vì sao lần đẩy TikTok gần nhất trượt + số lần đã thử + mốc được thử lại (backoff).
  // Không có 3 cột này thì đơn hỏng vĩnh viễn bị quét lại MỖI vòng cron, ăn hết 50s → đơn mới đói.
  tiktokPushError: text("tiktok_push_error"),
  tiktokPushAttempts: integer("tiktok_push_attempts").notNull().default(0),
  tiktokPushNextAt: timestamp("tiktok_push_next_at", { withTimezone: true }),
  // Thời điểm đã tạo fulfillment + tracking NGƯỢC lên Shopify qua Admin API. null = chưa đẩy.
  shopifyTrackingPushedAt: timestamp("shopify_tracking_pushed_at", { withTimezone: true }),
  // Vì sao lần đẩy Shopify gần nhất trượt + số lần đã thử + mốc được thử lại (backoff).
  // Giống bộ 3 cột TikTok: có lỗi lưu lại → hiện nút Push tay + cron retry, không im lặng nữa.
  shopifyPushError: text("shopify_push_error"),
  shopifyPushAttempts: integer("shopify_push_attempts").notNull().default(0),
  shopifyPushNextAt: timestamp("shopify_push_next_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_ff_order").on(t.orderId)]);

// ---------- FINANCE ----------
// ---------- OAUTH PKCE TẠM (Etsy) ----------
// Trước đây verifier PKCE nằm trong cookie httpOnly → callback BẮT BUỘC phải về đúng browser đã bấm
// Connect, nên muốn authorize shop trong AdsPower thì phải đăng nhập Fusion OS ngay trong AdsPower.
// Lưu server-side, tra theo `state` (random 32 byte, dùng 1 lần, hết hạn 10 phút) → không cần cookie,
// không cần session ở browser đó. Copy link dán sang AdsPower là chạy. An toàn hơn cookie.
export const oauthPending = pgTable("oauth_pending", {
  state: text("state").primaryKey(),
  verifier: text("verifier").notNull(),
  storeId: uuid("store_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- BLOCKLIST ĐƠN HỆ THỐNG CŨ ----------
// Danh sách Order ID đã xử lý ở hệ thống cũ. Mọi cửa ingest (extension, cron API, import Excel)
// đều bỏ qua đơn có external_id nằm ở đây → không bị push đúp sang nhà in trong lúc chuyển hệ thống.
// Không lưu platform: Order ID của Etsy (10 số) và TikTok (18–19 số) không đụng nhau,
// chặn theo ID thuần vừa đơn giản vừa an toàn hơn (nạp sai sàn cũng vẫn chặn đúng đơn).
export const ignoredOrders = pgTable("ignored_orders", {
  externalId: text("external_id").primaryKey(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: txTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  orderId: uuid("order_id"),
  storeId: uuid("store_id"),
  sellerId: uuid("seller_id"),
  note: text("note"),
  occurredAt: date("occurred_at").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_tx_type_date").on(t.type, t.occurredAt),
  index("idx_tx_seller").on(t.sellerId, t.occurredAt),
]);

// ---------- RBAC ----------
import { primaryKey, smallint } from "drizzle-orm/pg-core";

export const MODULES = ["dashboard", "orders", "fulfillment", "designs", "videos", "products", "reviews", "statsDesigners", "finance", "hr", "stores", "support", "marketing", "financeTiktok", "bookStudio", "genImage", "genVideo", "settings"] as const;
export type Module = (typeof MODULES)[number];

// 0 = ẩn · 1 = chỉ xem · 2 = toàn quyền
export const rolePermissions = pgTable("role_permissions", {
  role: roleEnum("role").notNull(),
  module: text("module").notNull(),
  level: smallint("level").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.role, t.module] })]);

// Giới hạn riêng từng người: own_orders_only, hide_profit, hide_customer_info, own_designs_only...
export const userRestrictions = pgTable("user_restrictions", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  restrictionKey: text("restriction_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.userId, t.restrictionKey] })]);

// Giới hạn dữ liệu áp theo ROLE (mặc định cho mọi user của role đó). user_restrictions vẫn override được từng người.
export const RESTRICTIONS = ["hide_profit", "own_orders_only", "own_designs_only", "hide_customer_info"] as const;
export type Restriction = (typeof RESTRICTIONS)[number];
export const roleRestrictions = pgTable("role_restrictions", {
  role: roleEnum("role").notNull(),
  restrictionKey: text("restriction_key").notNull(),
  enabled: boolean("enabled").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.role, t.restrictionKey] })]);

// Phạm vi dữ liệu theo role: 'all' (tất cả) · 'team' (cả team) · 'own' (chỉ của mình). Cho orders + designs.
export const SCOPES = ["all", "team", "own"] as const;
export const SCOPE_RESOURCES = ["orders", "designs"] as const;
export const roleDataScopes = pgTable("role_data_scopes", {
  role: roleEnum("role").notNull(),
  resource: text("resource").notNull(), // orders | designs
  scope: text("scope").notNull().default("all"), // all | team | own
}, (t) => [primaryKey({ columns: [t.role, t.resource] })]);

// Quyền HÀNH ĐỘNG chi tiết (tick như AdsPower). Không có bản ghi = mặc định CHO PHÉP (không phá hành vi cũ).
export const ACTIONS: { key: string; module: string; label: string }[] = [
  { key: "orders.import", module: "orders", label: "Import đơn" },
  { key: "orders.export", module: "orders", label: "Export đơn" },
  { key: "orders.trash", module: "orders", label: "Xoá / Cancel đơn" },
  { key: "orders.manual_cost", module: "orders", label: "Nhập tracking / cost tay" },
  { key: "designs.ai", module: "designs", label: "Sinh info bằng AI" },
  { key: "designs.delete", module: "designs", label: "Xoá design / file" },
  { key: "fulfillment.undo", module: "fulfillment", label: "Xoá / hoàn tác đơn đã đẩy" },
  { key: "fulfillment.credentials", module: "fulfillment", label: "Cấu hình credential nhà in" },
  { key: "stores.fx", module: "stores", label: "Đổi tỉ giá (FX)" },
];
export const roleActions = pgTable("role_actions", {
  role: roleEnum("role").notNull(),
  actionKey: text("action_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.role, t.actionKey] })]);

// ===== GHI ĐÈ THEO TỪNG USER (override role mặc định). Có bản ghi = dùng giá trị này; không có = theo role. =====
export const userPermissions = pgTable("user_permissions", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  module: text("module").notNull(),
  level: smallint("level").notNull(), // 0 ẩn · 1 xem · 2 full
}, (t) => [primaryKey({ columns: [t.userId, t.module] })]);
export const userDataScopes = pgTable("user_data_scopes", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  resource: text("resource").notNull(),
  scope: text("scope").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.resource] })]);
export const userActions = pgTable("user_actions", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  actionKey: text("action_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.userId, t.actionKey] })]);

// ---------- BOOK STUDIO (AI) ----------
// Một "đầu sách" chạy qua các khâu: idea → script → characters → simulation → mockup → ready.
export const bookTitles = pgTable("book_titles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  occasion: text("occasion"),          // dịp/ngách: 1st birthday, sleep book...
  audience: text("audience"),          // đối tượng/tuổi
  status: text("status").notNull().default("idea"), // idea|script|characters|simulation|mockup|ready
  productKey: text("product_key"),     // loại sản phẩm in (hardcover_photo_book_8x8…) — khoá khổ/số trang/nối trang
  kind: text("kind"),                  // null/'draft' = đang build · 'master' = SCALE DESIGN (đã có sale, làm mẫu custom cho khách)
  sourceId: uuid("source_id"),         // bản khách clone từ master nào (mở lại màn Customize + remake theo ảnh gốc)
  concept: jsonb("concept"),           // { hook, angle, usp, outline[] }
  personalization: jsonb("personalization"), // biến cá nhân hoá {name, character, dedication...}
  brief: jsonb("brief"),               // input brief đã dùng để sinh
  characterRefKey: text("character_ref_key"),  // ảnh reference nhân vật/style (R2) — mỏ neo nhất quán
  stylePrompt: text("style_prompt"),           // gợi ý style chung áp cho mọi trang (legacy → nay gộp vào bible.artStyle)
  bible: jsonb("bible"),                        // STYLE BIBLE: {character, wardrobe, artStyle, palette, textStyle, restrictions, format} — khai báo 1 lần, ráp vào MỌI trang
  cover: jsonb("cover"),                         // BÌA wraparound: {text (tiêu đề baked), brief (cảnh), prompt (đã ráp, sửa được)} — vẽ 1 tấm rồi cắt front/back
  vars: jsonb("vars"),                          // biến cá nhân hoá: [{key,label,value}] — thay [name]/[age]/[city]/[hobby] lúc gen
  ownerId: uuid("owner_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const bookPages = pgTable("book_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  titleId: uuid("title_id").notNull().references(() => bookTitles.id, { onDelete: "cascade" }),
  pageNo: integer("page_no").notNull(),
  textTemplate: text("text_template"),           // lời văn, chứa [name]...
  illustrationBrief: text("illustration_brief"), // mô tả cảnh để vẽ (brief chi tiết)
  promptTemplate: text("prompt_template"),       // PROMPT CHI TIẾT đã ráp (Bible + brief + text + restrictions), còn placeholder — sửa được
}, (t) => [index("idx_bookpages_title").on(t.titleId)]);
// Ảnh minh hoạ đã sinh cho từng trang (1 dòng/trang; vẽ lại thì thay).
export const bookAssets = pgTable("book_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  titleId: uuid("title_id").notNull().references(() => bookTitles.id, { onDelete: "cascade" }),
  pageNo: integer("page_no").notNull(),
  storageKey: text("storage_key").notNull(),
  model: text("model"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_bookassets_title").on(t.titleId)]);

// ---------- DESIGN REVIEWS (chấm điểm KPI) ----------
export const reviewDecisionEnum = pgEnum("review_decision", ["approve", "request_fix", "reject"]);

export const designReviews = pgTable("design_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  designId: uuid("design_id").notNull().references(() => designs.id, { onDelete: "cascade" }),
  reviewerId: uuid("reviewer_id").notNull().references(() => users.id),
  scoreBrief: smallint("score_brief"),
  scoreAesthetic: smallint("score_aesthetic"),
  scoreTechnical: smallint("score_technical"),
  qualityScore: numeric("quality_score", { precision: 4, scale: 2 }),
  disciplineScore: numeric("discipline_score", { precision: 4, scale: 2 }),
  businessScore: numeric("business_score", { precision: 4, scale: 2 }),
  totalScore: numeric("total_score", { precision: 4, scale: 2 }),
  decision: reviewDecisionEnum("decision").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_reviews_design").on(t.designId)]);

// ---------- ĐƠN ĐÁNH GIÁ XẤU / LỖI (report theo supplier) ----------
export const orderIssues = pgTable("order_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  fulfillerId: uuid("fulfiller_id").references(() => fulfillers.id),
  reason: text("reason").notNull(),
  imageKey: text("image_key"),
  reporterId: uuid("reporter_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_issue_order").on(t.orderId), index("idx_issue_ff").on(t.fulfillerId)]);

// ---------- TEAMS (nhóm nhân viên; membership qua users.team = teams.name) ----------
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  // Chat ID group Telegram của team — bot bắn thông báo SALE về đây (MIGRATION_team_telegram.sql)
  telegramChatId: text("telegram_chat_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- v272 · VIDEO CARDS (card cha — video con, kiểu SKU cha/variant con) ----------
// 1 card = 1 seller + 1 creator + 1 product listing. Mã card đọc được: <Seller>-<Creator>-<NN>
// (vd QT-TH-01), video con đánh số QT-TH-01.1/.2/… (cardSeq). videoCode global GIỮ NGUYÊN —
// là khoá UTM video_<code> đã đăng. productId của card luôn ĐỒNG BỘ xuống video con
// (route assign/captions lo việc này) nên các flow cũ (push, UTM, captions) chạy y nguyên.
// Cần MIGRATION_v272_video_cards.sql
export const videoCards = pgTable("video_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),                  // "QT-TH-01" — sinh từ tên seller/creator (bỏ dấu)
  seq: integer("seq").notNull(),                          // số NN, đếm riêng theo cặp (sellerId, creatorId)
  sellerId: uuid("seller_id").references(() => users.id),
  creatorId: uuid("creator_id").references(() => users.id),
  storeId: uuid("store_id"),
  productId: uuid("product_id"),                          // 1 card đúng 1 listing (shopify_products.id)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [index("idx_vcards_pair").on(t.sellerId, t.creatorId), index("idx_vcards_product").on(t.productId)]);

// ---------- v207 · VIDEO LIBRARY (creator upload → duyệt → Shopify + caption cho social) ----------
// File KHÔNG đi qua Vercel: browser PUT thẳng lên R2 bằng presigned URL (src/lib/storage.ts),
// bảng này chỉ giữ metadata + trạng thái duyệt + caption AI cho từng kênh.
// Cần MIGRATION_v207_product_videos.sql
export const productVideos = pgTable("product_videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  // v209 · ID ngắn để người nói chuyện với nhau ("dùng video 102") — giống skuCode bên Design Studio.
  videoCode: serial("video_code").notNull(),
  storeId: uuid("store_id"),                              // store Shopify (để seller chỉ thấy video của mình)
  // v209c · Bộ ba người giống designs: seller ĐẶT · creator QUAY · uploadedBy người bấm upload.
  sellerId: uuid("seller_id").references(() => users.id),
  creatorId: uuid("creator_id").references(() => users.id),
  // Số lần thay file (creator sửa clip rồi update đè) — giữ #ID, chỉ đổi file.
  revision: integer("revision").notNull().default(1),
  // Điểm cho video (giống points bên Design) — dùng chấm công/thưởng creator. 0–10. Xem MIGRATION_v244.
  points: integer("points").notNull().default(0),
  productId: uuid("product_id"),                          // shopify_products.id (bản ghi local) — có thể để trống
  // v272 · card cha + số thứ tự con trong card (QT-TH-01.<cardSeq>). Xoá card → video về "lẻ" (set null).
  cardId: uuid("card_id").references(() => videoCards.id, { onDelete: "set null" }),
  cardSeq: integer("card_seq"),
  title: text("title").notNull(),
  note: text("note"),
  storageKey: text("storage_key").notNull(),              // key trên R2
  publicUrl: text("public_url"),                          // URL công khai chốt lúc upload (Meta/TikTok cần tải về được)
  thumbKey: text("thumb_key"),                            // ảnh poster (frame đầu) — client tự bắt bằng <canvas>
  thumbUrl: text("thumb_url"),
  contentType: text("content_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  durationSec: numeric("duration_sec", { precision: 8, scale: 2 }),
  width: integer("width"),
  height: integer("height"),
  aspect: text("aspect"),                                 // "9:16" | "1:1" | "16:9" | "other"
  // ---- v209b · Metadata để SAU NÀY còn dùng lại được clip (lọc, chọn đúng clip cho đúng chỗ) ----
  // kind = loại cảnh quay, khớp brief gửi creator: material / size / assembly / safety / unboxing /
  //        lifestyle / howto / other. Đây là trục lọc chính khi thư viện lớn.
  kind: text("kind"),
  language: text("language"),                             // "none" (không lời) | "en" | "vi"
  // flags: { voice, text, music } — có lời thoại / có chữ trên hình / có nhạc nền.
  // Quyết định clip tái sử dụng được ở kênh nào và có phải dựng lại không.
  flags: jsonb("flags"),
  sourceName: text("source_name"),                        // creator/agency NGOÀI hệ thống (không có account)
  shotAt: date("shot_at"),                                // ngày quay (khác ngày upload)
  // pending = chờ duyệt · approved = được dùng · rejected = loại
  status: text("status").notNull().default("pending"),
  reviewNote: text("review_note"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  // caption AI theo từng kênh: { tiktok:{text,hashtags[]}, reels:{...}, shorts:{...}, facebook:{...}, pinterest:{...} }
  captions: jsonb("captions"),
  captionsAt: timestamp("captions_at", { withTimezone: true }),
  shopifyMediaId: text("shopify_media_id"),               // GID media sau khi đẩy lên Shopify
  shopifyPushedAt: timestamp("shopify_pushed_at", { withTimezone: true }),
  // đánh dấu ĐÃ ĐĂNG tay ở kênh nào: { tiktok:"2026-08-10T…", reels:"…" }
  postedTo: jsonb("posted_to").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("idx_pvideos_store").on(t.storeId, t.createdAt),
  index("idx_pvideos_product").on(t.productId),
  index("idx_pvideos_card").on(t.cardId, t.cardSeq),
  index("idx_pvideos_status").on(t.status, t.createdAt),
  index("idx_pvideos_uploader").on(t.uploadedBy, t.createdAt),
]);


// ---------- AI PROMPTS OVERRIDE (Manager Prompts — admin) ----------
// Ghi đè prompt AI theo id (khớp PROMPT_META trong src/lib/ai/prompt-defs.ts). CÓ dòng = dùng bản này,
// KHÔNG có = rơi về default trong prompt-defs.ts. Chỉ admin sửa (trang /prompts). getPrompt() đọc bảng này,
// nếu bảng chưa tồn tại (chưa migrate) thì tự bắt lỗi → vẫn chạy bằng default. Reset = xoá dòng.
export const aiPrompts = pgTable("ai_prompts", {
  id: text("id").primaryKey(),                            // vd "amazon.listing", "shopify.optimize.base"
  value: text("value").notNull(),                         // nội dung prompt admin ghi đè
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- SUPPORT EMAIL (v392 · hộp thư support@talewix.com trong FUSION) ----------
// Cron tick kéo mail qua IMAP (PrivateEmail/Namecheap) → 2 bảng dưới. Nhân viên đọc/rep tại
// /support-email theo quyền module "support" (1 = xem, 2 = trả lời/đóng). Mật khẩu hộp thư chỉ
// nằm trong env (SUPPORT_EMAIL / SUPPORT_EMAIL_PASS) — không ai phải cầm email gốc.
// v393: NHIỀU hộp thư — mỗi store/brand 1 account, admin thêm/sửa ngay trong FUSION
// (không cần env + redeploy). Mật khẩu mã hoá AES-256-GCM (lib/crypto, khoá từ AUTH_SECRET).
export const supportEmailAccounts = pgTable("support_email_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),                 // tên hiển thị: "Talewix", "Store B"…
  email: text("email").notNull(),
  fromName: text("from_name"),                    // tên người gửi khi reply (mặc định = label + " Support")
  imapHost: text("imap_host").notNull().default("mail.privateemail.com"),
  imapPort: integer("imap_port").notNull().default(993),
  smtpHost: text("smtp_host").notNull().default("mail.privateemail.com"),
  smtpPort: integer("smtp_port").notNull().default(465),
  passEnc: text("pass_enc").notNull(),            // encryptSecret(mật khẩu hộp thư)
  active: boolean("active").notNull().default(true),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("uq_sup_email_accounts_email").on(t.email)]);

export const supportEmailThreads = pgTable("support_email_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  // v393: thread thuộc hộp thư nào. NULL = hộp thư cấu hình bằng env (SUPPORT_EMAIL) thời v392.
  accountId: uuid("account_id").references(() => supportEmailAccounts.id),
  customerEmail: text("customer_email").notNull(),
  customerName: text("customer_name"),
  subject: text("subject").notNull().default(""),          // subject gốc (đã bỏ Re:/Fwd:)
  status: text("status").notNull().default("open"),        // open | closed
  lastDirection: text("last_direction").notNull().default("in"), // in = khách vừa nhắn (chờ rep) | out
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  lastSnippet: text("last_snippet").notNull().default(""),
  unread: boolean("unread").notNull().default(true),
  msgCount: integer("msg_count").notNull().default(0),
  assignedTo: uuid("assigned_to").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_sup_email_threads_last").on(t.lastMessageAt),
  index("idx_sup_email_threads_customer").on(t.customerEmail),
  index("idx_sup_email_threads_account").on(t.accountId),
]);

export const supportEmailMessages = pgTable("support_email_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => supportEmailThreads.id),
  direction: text("direction").notNull(),                  // in (khách gửi) | out (mình rep)
  // v394: folder IMAP của mail — inbox | sent | archive | spam | trash | drafts.
  // Mail bị move trong webmail sẽ được cập nhật lại folder ở vòng sync sau.
  folder: text("folder").notNull().default("inbox"),
  messageId: text("message_id"),                           // Message-ID header — khoá dedupe khi sync IMAP
  inReplyTo: text("in_reply_to"),
  refs: text("refs"),                                      // References header (nối thread phía khách)
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name"),
  toEmail: text("to_email"),
  subject: text("subject"),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  attachments: jsonb("attachments").notNull().default([]), // [{ name, key, size, type }] — file lưu storage
  sentByUserId: uuid("sent_by_user_id").references(() => users.id), // nhân viên bấm gửi (direction=out)
  messageAt: timestamp("message_at", { withTimezone: true }).notNull().defaultNow(), // Date header
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_sup_email_msgs_thread").on(t.threadId),
  uniqueIndex("uq_sup_email_msgs_mid").on(t.messageId),
  index("idx_sup_email_msgs_folder").on(t.folder),
]);
