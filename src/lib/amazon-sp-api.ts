/**
 * Amazon Selling Partner API — tầng gọi API (v306 · config theo TỪNG STORE Amazon).
 *
 * SP-API từ 2024 KHÔNG còn cần AWS IAM / Signature v4: chỉ cần LWA (Login with Amazon).
 *   refresh_token + client_id + client_secret  →  access_token (1h)  →  gọi API với header
 *   x-amz-access-token. Xem: developer-docs.amazon.com/sp-api (bỏ SigV4).
 *
 * v306: KHÔNG còn bảng singleton amazon_api_config. Khóa SP-API nằm trong
 *   stores.api_credentials.spapi của chính store Amazon (marketplace='amazon') —
 *   mỗi tài khoản Amazon 1 store, sẵn sàng đa-tài-khoản. Bí mật nằm trong DB seller.
 */
import { db, schema } from "@/lib/db";
import { eq, desc } from "drizzle-orm";

export type SpCfg = {
  storeId: string;
  region: string;                 // na / eu / fe
  marketplaceId: string;          // US = ATVPDKIKX0DER
  sellerId: string | null;        // Merchant/Seller ID
  lwaClientId: string | null;
  lwaClientSecret: string | null;
  refreshToken: string | null;
  lastSyncAt: Date | null;
};

const HOSTS: Record<string, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};

type SpBlob = {
  region?: string; marketplaceId?: string; sellerId?: string;
  lwaClientId?: string; lwaClientSecret?: string; refreshToken?: string; lastSyncAt?: string;
};

function toCfg(storeId: string, cred: unknown): SpCfg {
  const sp = (((cred ?? {}) as Record<string, unknown>).spapi ?? {}) as SpBlob;
  return {
    storeId,
    region: sp.region || "na",
    marketplaceId: sp.marketplaceId || "ATVPDKIKX0DER",
    sellerId: sp.sellerId || null,
    lwaClientId: sp.lwaClientId || null,
    lwaClientSecret: sp.lwaClientSecret || null,
    refreshToken: sp.refreshToken || null,
    lastSyncAt: sp.lastSyncAt ? new Date(sp.lastSyncAt) : null,
  };
}

/** Lấy id store Amazon (marketplace='amazon'). storeId chỉ định thì lấy đúng store đó. */
export async function getAmazonStoreId(storeId?: string): Promise<string | null> {
  if (storeId) {
    const [s] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    return s?.id ?? null;
  }
  const [s] = await db.select({ id: schema.stores.id }).from(schema.stores)
    .where(eq(schema.stores.marketplace, "amazon" as never))
    .orderBy(desc(schema.stores.createdAt)).limit(1);
  return s?.id ?? null;
}

/** Đọc cấu hình SP-API từ store Amazon. storeId trống = store Amazon mới nhất. */
export async function getSpConfig(storeId?: string): Promise<SpCfg | null> {
  const rows = await db.select({ id: schema.stores.id, cred: schema.stores.apiCredentials })
    .from(schema.stores)
    .where(storeId ? eq(schema.stores.id, storeId) : eq(schema.stores.marketplace, "amazon" as never))
    .orderBy(desc(schema.stores.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return toCfg(row.id, row.cred);
}

/** Ghi (merge) các field SP-API vào store.api_credentials.spapi. undefined = giữ nguyên. */
export async function mergeSpConfig(storeId: string, patch: Partial<SpBlob>): Promise<void> {
  const [row] = await db.select({ cred: schema.stores.apiCredentials }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  const cred = { ...((row?.cred ?? {}) as Record<string, unknown>) };
  const sp = { ...((cred.spapi ?? {}) as SpBlob) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;   // bỏ trống = giữ nguyên
    (sp as Record<string, unknown>)[k] = v;
  }
  cred.spapi = sp;
  await db.update(schema.stores).set({ apiCredentials: cred }).where(eq(schema.stores.id, storeId));
}

/** Đánh dấu thời điểm sync gần nhất trong spapi.lastSyncAt. */
export async function touchSpSync(storeId: string): Promise<void> {
  await mergeSpConfig(storeId, { lastSyncAt: new Date().toISOString() }).catch(() => {});
}

export function spConfigured(c: SpCfg | null): boolean {
  return !!(c && c.lwaClientId && c.lwaClientSecret && c.refreshToken && c.sellerId);
}

// Cache access token theo refresh_token (mỗi instance serverless tự giữ ~55 phút).
const tokenCache = new Map<string, { token: string; exp: number }>();

export async function getAccessToken(c: SpCfg): Promise<string> {
  const key = String(c.refreshToken);
  const hit = tokenCache.get(key);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;

  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: String(c.refreshToken),
      client_id: String(c.lwaClientId),
      client_secret: String(c.lwaClientSecret),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.access_token) {
    throw new Error(`LWA token lỗi (${res.status}): ${j?.error_description ?? j?.error ?? "unknown"}`);
  }
  const token = j.access_token as string;
  const exp = Date.now() + (Number(j.expires_in ?? 3600) * 1000);
  tokenCache.set(key, { token, exp });
  return token;
}

async function spFetch(c: SpCfg, path: string, opts: { query?: Record<string, string>; method?: string; body?: unknown } = {}): Promise<{ status: number; json: unknown }> {
  const token = await getAccessToken(c);
  const host = HOSTS[c.region ?? "na"] ?? HOSTS.na;
  const qs = new URLSearchParams(opts.query ?? {}).toString();
  const url = `${host}${path}${qs ? "?" + qs : ""}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: { "x-amz-access-token": token, "Content-Type": "application/json" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

export type ListingInfo = { asin: string | null; status: string; parentAsin?: string | null };

/**
 * Listings Items API — lấy ASIN + trạng thái theo Seller SKU.
 * GET /listings/2021-08-01/items/{sellerId}/{sku}?marketplaceIds=..&includedData=summaries
 */
export async function getListing(c: SpCfg, sku: string): Promise<ListingInfo | null> {
  const { status, json } = await spFetch(c, `/listings/2021-08-01/items/${encodeURIComponent(String(c.sellerId))}/${encodeURIComponent(sku)}`, {
    query: { marketplaceIds: String(c.marketplaceId), includedData: "summaries" },
  });
  if (status === 404) return null;
  if (status !== 200) {
    const j = json as { errors?: { message?: string }[] } | null;
    throw new Error(`getListing ${sku} lỗi ${status}: ${j?.errors?.[0]?.message ?? "unknown"}`);
  }
  const j = json as { summaries?: { asin?: string; status?: string[] }[] } | null;
  const s = j?.summaries?.[0];
  if (!s) return null;
  return { asin: s.asin ?? null, status: (s.status ?? []).join(",") };
}

// ───────────── Listings Items API — UPDATE trực tiếp (thay Feeds flat-file bị 403) ─────────────
export type PatchOp = { op: "replace" | "add" | "delete"; path: string; value?: unknown };
export type PatchResult = { sku: string; status: string; issues: { code?: string; message?: string; severity?: string }[] };

/** PATCH 1 SKU đã tồn tại trên Amazon (cập nhật title/bullets/desc/giá…). Dùng role Product Listing. */
export async function patchListingItem(c: SpCfg, sku: string, productType: string, patches: PatchOp[]): Promise<PatchResult> {
  const { status, json } = await spFetch(c, `/listings/2021-08-01/items/${encodeURIComponent(String(c.sellerId))}/${encodeURIComponent(sku)}`, {
    method: "PATCH",
    query: { marketplaceIds: String(c.marketplaceId) },
    body: { productType, patches },
  });
  const j = json as { sku?: string; status?: string; issues?: { code?: string; message?: string; severity?: string }[]; errors?: { message?: string }[] } | null;
  if (status !== 200) throw new Error(`patch ${sku} lỗi ${status}: ${j?.errors?.[0]?.message ?? j?.issues?.[0]?.message ?? "unknown"}`);
  return { sku, status: j?.status ?? "UNKNOWN", issues: j?.issues ?? [] };
}

/** PUT tạo/ghi đè 1 SKU (đầy đủ attributes). Dùng khi tạo listing mới qua API. */
export async function putListingItem(c: SpCfg, sku: string, productType: string, attributes: Record<string, unknown>): Promise<PatchResult> {
  const { status, json } = await spFetch(c, `/listings/2021-08-01/items/${encodeURIComponent(String(c.sellerId))}/${encodeURIComponent(sku)}`, {
    method: "PUT",
    query: { marketplaceIds: String(c.marketplaceId) },
    body: { productType, requirements: "LISTING", attributes },
  });
  const j = json as { sku?: string; status?: string; issues?: { code?: string; message?: string; severity?: string }[]; errors?: { message?: string }[] } | null;
  if (status !== 200 && status !== 202) throw new Error(`put ${sku} lỗi ${status}: ${j?.errors?.[0]?.message ?? j?.issues?.[0]?.message ?? "unknown"}`);
  return { sku, status: j?.status ?? "UNKNOWN", issues: j?.issues ?? [] };
}

/** DELETE 1 SKU khỏi Amazon (dùng khi parent nhiễm parentage_level sai — Amazon bắt xóa rồi tạo lại). */
export async function deleteListingItem(c: SpCfg, sku: string): Promise<{ ok: boolean; status: number }> {
  const { status } = await spFetch(c, `/listings/2021-08-01/items/${encodeURIComponent(String(c.sellerId))}/${encodeURIComponent(sku)}`, {
    method: "DELETE",
    query: { marketplaceIds: String(c.marketplaceId) },
  });
  return { ok: status === 200, status };
}

// Helper build value theo chuẩn Listings Items API (mỗi attr = mảng {value, marketplace_id,...}).
export const MK_US = "ATVPDKIKX0DER";
export const vText = (value: string, mk: string) => [{ value, marketplace_id: mk, language_tag: "en_US" }];
export const vPlain = (value: unknown, mk: string) => [{ value, marketplace_id: mk }];

// Dữ liệu đầy đủ 1 listing để IMPORT về (title/bullets/desc/variations/giá/ảnh/type).
export type ListingData = {
  asin: string | null;
  status: string;
  productType: string;
  attributes: Record<string, unknown>;
  offers: unknown[];
  relationships: unknown[];
  issues: { code?: string; message?: string; severity?: string; attributeNames?: string[] }[];
};

/** getListing kèm nhiều includedData để import. */
export async function getListingData(c: SpCfg, sku: string, included = "summaries,attributes,offers,relationships"): Promise<ListingData | null> {
  const { status, json } = await spFetch(c, `/listings/2021-08-01/items/${encodeURIComponent(String(c.sellerId))}/${encodeURIComponent(sku)}`, {
    query: { marketplaceIds: String(c.marketplaceId), includedData: included },
  });
  if (status === 404) return null;
  if (status !== 200) {
    const j = json as { errors?: { message?: string }[] } | null;
    throw new Error(`getListingData ${sku} lỗi ${status}: ${j?.errors?.[0]?.message ?? "unknown"}`);
  }
  const j = json as {
    summaries?: { asin?: string; status?: string[]; productType?: string }[];
    attributes?: Record<string, unknown>;
    offers?: unknown[];
    relationships?: { relationships?: unknown[] }[];
    issues?: { code?: string; message?: string; severity?: string; attributeNames?: string[] }[];
  } | null;
  const s = j?.summaries?.[0];
  const rel = (j?.relationships ?? []).flatMap((r) => r?.relationships ?? []);
  return {
    asin: s?.asin ?? null,
    status: (s?.status ?? []).join(","),
    productType: s?.productType ?? "",
    attributes: j?.attributes ?? {},
    offers: j?.offers ?? [],
    relationships: rel,
    issues: j?.issues ?? [],
  };
}

/** Lấy value đầu tiên của 1 attribute (Listings JSON: attr = [{value, marketplace_id}]). */
export function attrVal(attrs: Record<string, unknown>, key: string): string {
  const a = attrs?.[key];
  if (!Array.isArray(a) || !a.length) return "";
  const first = a[0] as Record<string, unknown>;
  return String(first?.value ?? first?.media_location ?? "").trim();
}
/** Lấy tất cả value của 1 attribute (vd bullet_point). */
export function attrVals(attrs: Record<string, unknown>, key: string): string[] {
  const a = attrs?.[key];
  if (!Array.isArray(a)) return [];
  return a.map((x) => String((x as Record<string, unknown>)?.value ?? "").trim()).filter(Boolean);
}

// Rate-limit nhẹ: Listings getItem ~5 req/s. Gọi tuần tự có nghỉ để an toàn.
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── FEEDS API (⬆ Push to Amazon) ─────────────────────────
// Đẩy listing bằng feed POST_FLAT_FILE_LISTINGS_DATA — cùng nội dung .txt đã kiểm chứng chạy live,
// tự upload + tự chạy, không cần thao tác tay ở Seller Central.

const FEED_CONTENT_TYPE = "text/tab-separated-values; charset=UTF-8";

/** B1: tạo feed document → nhận feedDocumentId + presigned URL để PUT nội dung lên. */
export async function createFeedDocument(c: SpCfg): Promise<{ feedDocumentId: string; url: string }> {
  const { status, json } = await spFetch(c, "/feeds/2021-06-30/documents", { method: "POST", body: { contentType: FEED_CONTENT_TYPE } });
  const j = json as { feedDocumentId?: string; url?: string; errors?: { message?: string }[] } | null;
  if (status !== 201 && status !== 200) throw new Error(`createFeedDocument ${status}: ${j?.errors?.[0]?.message ?? "unknown"}`);
  if (!j?.feedDocumentId || !j?.url) throw new Error("createFeedDocument: thiếu feedDocumentId/url");
  return { feedDocumentId: j.feedDocumentId, url: j.url };
}

/** B2: PUT nội dung .txt lên presigned URL (Content-Type PHẢI khớp lúc tạo document). */
export async function uploadFeedContent(url: string, content: string): Promise<void> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": FEED_CONTENT_TYPE },
    body: content,
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) throw new Error(`uploadFeedContent ${res.status}`);
}

/** B3: tạo feed dùng document vừa upload → nhận feedId. */
export async function createFeed(c: SpCfg, inputFeedDocumentId: string): Promise<{ feedId: string }> {
  const { status, json } = await spFetch(c, "/feeds/2021-06-30/feeds", {
    method: "POST",
    body: { feedType: "POST_FLAT_FILE_LISTINGS_DATA", marketplaceIds: [String(c.marketplaceId)], inputFeedDocumentId },
  });
  const j = json as { feedId?: string; errors?: { message?: string }[] } | null;
  if (status !== 202 && status !== 201 && status !== 200) throw new Error(`createFeed ${status}: ${j?.errors?.[0]?.message ?? "unknown"}`);
  if (!j?.feedId) throw new Error("createFeed: thiếu feedId");
  return { feedId: j.feedId };
}

export type FeedStatus = { processingStatus: string; resultFeedDocumentId?: string | null };

/** Trạng thái feed: IN_QUEUE / IN_PROGRESS / DONE / CANCELLED / FATAL. */
export async function getFeed(c: SpCfg, feedId: string): Promise<FeedStatus> {
  const { status, json } = await spFetch(c, `/feeds/2021-06-30/feeds/${encodeURIComponent(feedId)}`);
  const j = json as { processingStatus?: string; resultFeedDocumentId?: string; errors?: { message?: string }[] } | null;
  if (status !== 200) throw new Error(`getFeed ${status}: ${j?.errors?.[0]?.message ?? "unknown"}`);
  return { processingStatus: j?.processingStatus ?? "UNKNOWN", resultFeedDocumentId: j?.resultFeedDocumentId ?? null };
}

/** Tải processing report của feed (mô tả kết quả xử lý — bao nhiêu dòng OK/lỗi). */
export async function getFeedResult(c: SpCfg, resultFeedDocumentId: string): Promise<string> {
  const { status, json } = await spFetch(c, `/feeds/2021-06-30/documents/${encodeURIComponent(resultFeedDocumentId)}`);
  const j = json as { url?: string; compressionAlgorithm?: string } | null;
  if (status !== 200 || !j?.url) throw new Error(`getFeedResult ${status}`);
  const res = await fetch(j.url, { signal: AbortSignal.timeout(30_000) });
  const buf = Buffer.from(await res.arrayBuffer());
  if ((j.compressionAlgorithm ?? "").toUpperCase() === "GZIP") {
    const { gunzipSync } = await import("zlib");
    return gunzipSync(buf).toString("utf-8");
  }
  return buf.toString("utf-8");
}
