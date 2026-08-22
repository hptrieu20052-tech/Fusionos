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

async function spFetch(c: SpCfg, path: string, query: Record<string, string> = {}): Promise<{ status: number; json: unknown }> {
  const token = await getAccessToken(c);
  const host = HOSTS[c.region ?? "na"] ?? HOSTS.na;
  const qs = new URLSearchParams(query).toString();
  const url = `${host}${path}${qs ? "?" + qs : ""}`;
  const res = await fetch(url, {
    headers: { "x-amz-access-token": token, "Content-Type": "application/json" },
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
    marketplaceIds: String(c.marketplaceId),
    includedData: "summaries",
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

// Rate-limit nhẹ: Listings getItem ~5 req/s. Gọi tuần tự có nghỉ để an toàn.
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
