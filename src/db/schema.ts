import {
  pgTable, pgEnum, uuid, text, integer, bigint, boolean, numeric,
  timestamp, date, jsonb, serial, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------- ENUMS ----------
export const roleEnum = pgEnum("user_role", ["admin", "seller", "designer", "support", "content", "hiring"]);
export const userStatusEnum = pgEnum("user_status", ["active", "pending", "leave", "disabled"]);
export const marketplaceEnum = pgEnum("marketplace", ["tiktok", "amazon", "etsy", "other"]);
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
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_stores_seller").on(t.sellerId)]);

// ---------- ORDERS ----------
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").notNull(),
  platform: marketplaceEnum("platform").notNull(),
  storeId: uuid("store_id").references(() => stores.id),
  sellerId: uuid("seller_id").references(() => users.id),
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
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  platformFee: numeric("platform_fee", { precision: 12, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("USD"),
  orderLabel: text("order_label"),
  note: text("note"),
  orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_orders_platform_external").on(t.platform, t.externalId),
  index("idx_orders_seller_date").on(t.sellerId, t.orderedAt),
  index("idx_orders_status").on(t.status),
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

// ---------- FULFILLMENT ----------
export const fulfillers = pgTable("fulfillers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  method: text("method").notNull(), // api | excel
  apiEndpoint: text("api_endpoint"),
  credentials: jsonb("credentials"),
  webhookSecret: text("webhook_secret"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  autoPush: boolean("auto_push").notNull().default(false),
  safeMode: boolean("safe_mode").notNull().default(false),
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
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_ff_order").on(t.orderId)]);

// ---------- FINANCE ----------
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

export const MODULES = ["dashboard", "orders", "fulfillment", "designs", "reviews", "statsDesigners", "finance", "hr", "stores", "settings"] as const;
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
