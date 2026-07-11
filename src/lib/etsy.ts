import { createHash, randomBytes } from "crypto";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

// ===== Etsy Open API v3 — official integration (1 app riêng cho mỗi store) =====
export const ETSY_AUTHORIZE = "https://www.etsy.com/oauth/connect";
export const ETSY_TOKEN = "https://api.etsy.com/v3/public/oauth/token";
export const ETSY_API = "https://openapi.etsy.com/v3/application";
// Đọc đơn (receipts) + GHI tracking (createReceiptShipment). Cần cả 2 scope.
export const ETSY_SCOPE = "transactions_r transactions_w";

export type EtsyCfg = {
  keystring: string;
  sharedSecret: string;
  shopId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms
};

type Cred = Record<string, string>;

// ---- Đọc/ghi cấu hình Etsy API trong stores.api_credentials (secret + token mã hoá) ----
export function readEtsyCfg(cred: Cred | null | undefined): EtsyCfg {
  const c = (cred ?? {}) as Cred;
  return {
    keystring: c.etsy_keystring || "",
    sharedSecret: decryptSecret(c.etsy_shared_secret),
    shopId: c.etsy_shop_id || "",
    accessToken: decryptSecret(c.etsy_access_token),
    refreshToken: decryptSecret(c.etsy_refresh_token),
    expiresAt: Number(c.etsy_expires_at || 0),
  };
}

export async function saveEtsyCfg(storeId: string, patch: Partial<EtsyCfg>) {
  const [s] = await db.select({ c: schema.stores.apiCredentials }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  const cur = (s?.c ?? {}) as Cred;
  const next: Cred = { ...cur };
  if (patch.keystring !== undefined) next.etsy_keystring = patch.keystring;
  if (patch.sharedSecret !== undefined) next.etsy_shared_secret = encryptSecret(patch.sharedSecret);
  if (patch.shopId !== undefined) next.etsy_shop_id = patch.shopId;
  if (patch.accessToken !== undefined) next.etsy_access_token = encryptSecret(patch.accessToken);
  if (patch.refreshToken !== undefined) next.etsy_refresh_token = encryptSecret(patch.refreshToken);
  if (patch.expiresAt !== undefined) next.etsy_expires_at = String(patch.expiresAt);
  await db.update(schema.stores).set({ apiCredentials: next }).where(eq(schema.stores.id, storeId));
}

// ---- PKCE (Etsy bắt buộc trên mọi luồng authorize) ----
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function makePkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  return { verifier, challenge, state };
}

export function authorizeUrl(keystring: string, redirectUri: string, challenge: string, state: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: keystring,
    redirect_uri: redirectUri,
    scope: ETSY_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${ETSY_AUTHORIZE}?${p.toString()}`;
}

// ---- Đổi authorization code → access + refresh token ----
export async function exchangeCode(keystring: string, code: string, verifier: string, redirectUri: string) {
  const r = await fetch(ETSY_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: keystring,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `token exchange failed (${r.status})`);
  return j as { access_token: string; refresh_token: string; expires_in: number };
}

// ---- Refresh access token (refresh token sống ~90 ngày) ----
export async function refreshAccess(keystring: string, refreshToken: string) {
  const r = await fetch(ETSY_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: keystring, refresh_token: refreshToken }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `refresh failed (${r.status})`);
  return j as { access_token: string; refresh_token: string; expires_in: number };
}

// x-api-key: keystring:secret (bắt buộc từ 9/2/2026)
const apiKey = (cfg: EtsyCfg) => `${cfg.keystring}:${cfg.sharedSecret}`;

// ---- getMe: lấy user_id + shop_id cho token hiện tại ----
export async function getMe(cfg: EtsyCfg): Promise<{ userId: string; shopId: string }> {
  const r = await fetch(`${ETSY_API}/users/me`, {
    headers: { "x-api-key": apiKey(cfg), Authorization: `Bearer ${cfg.accessToken}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `getMe failed (${r.status})`);
  return { userId: String(j.user_id ?? ""), shopId: String(j.shop_id ?? "") };
}

// ---- Đảm bảo access token còn hạn; refresh + lưu lại nếu sắp hết ----
export async function getValidCfg(storeId: string, cred: Cred | null | undefined): Promise<EtsyCfg> {
  const cfg = readEtsyCfg(cred);
  if (!cfg.keystring || !cfg.refreshToken) throw new Error("Store is not connected to the Etsy API");
  // refresh nếu còn dưới 2 phút
  if (!cfg.accessToken || cfg.expiresAt < Date.now() + 120_000) {
    const t = await refreshAccess(cfg.keystring, cfg.refreshToken);
    cfg.accessToken = t.access_token;
    cfg.refreshToken = t.refresh_token || cfg.refreshToken;
    cfg.expiresAt = Date.now() + (t.expires_in || 3600) * 1000;
    await saveEtsyCfg(storeId, { accessToken: cfg.accessToken, refreshToken: cfg.refreshToken, expiresAt: cfg.expiresAt });
  }
  return cfg;
}

// ---- Lấy receipts (đơn) — phân trang ----
type EtsyMoney = { amount?: number; divisor?: number };
type EtsyTxn = { title?: string; sku?: string; quantity?: number; price?: EtsyMoney; listing_id?: number; variations?: { formatted_name?: string; formatted_value?: string }[] };
type EtsyReceipt = {
  receipt_id?: number; name?: string; status?: string; message_from_buyer?: string;
  first_line?: string; second_line?: string; city?: string; state?: string; zip?: string; country_iso?: string;
  grandtotal?: EtsyMoney; total_price?: EtsyMoney; transactions?: EtsyTxn[];
};

const money = (m?: EtsyMoney) => (m && m.divisor ? Number(m.amount || 0) / Number(m.divisor) : 0);

export async function fetchReceipts(cfg: EtsyCfg, maxOrders = 250): Promise<EtsyReceipt[]> {
  const out: EtsyReceipt[] = [];
  const limit = 100;
  // Chỉ lấy đơn ~45 ngày gần đây (đủ cho vận hành, tránh kéo hết lịch sử cũ).
  const minCreated = Math.floor(Date.now() / 1000) - 45 * 86400;
  for (let offset = 0; offset < maxOrders; offset += limit) {
    const url = `${ETSY_API}/shops/${cfg.shopId}/receipts?limit=${limit}&offset=${offset}&min_created=${minCreated}`;
    const r = await fetch(url, { headers: { "x-api-key": apiKey(cfg), Authorization: `Bearer ${cfg.accessToken}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `getShopReceipts failed (${r.status})`);
    const results: EtsyReceipt[] = Array.isArray(j.results) ? j.results : [];
    out.push(...results);
    if (results.length < limit) break;
  }
  return out;
}

// ---- Chuẩn hoá receipt → order shape mà FUSION ingest dùng ----
const PERSO = /personal|monogram|custom|khắc|tên/i;
export function normalizeReceipt(rc: EtsyReceipt) {
  const name = (rc.name || "").trim();
  const sp = name.indexOf(" ");
  const buyerFirst = sp > 0 ? name.slice(0, sp) : name;
  const buyerLast = sp > 0 ? name.slice(sp + 1) : "";
  const items = (rc.transactions || []).map((t) => {
    const variantParts: string[] = [];
    const persoParts: string[] = [];
    for (const v of t.variations || []) {
      const nm = (v.formatted_name || "").trim();
      const val = (v.formatted_value || "").trim();
      if (!val) continue;
      if (PERSO.test(nm)) persoParts.push(val);
      else variantParts.push(nm ? `${nm}: ${val}` : val);
    }
    return {
      title: t.title || "",
      sku: t.sku || "",
      qty: Number(t.quantity || 1),
      price: money(t.price),
      variant: variantParts.join(" · ") || undefined,
      personalization: persoParts.join(" · ") || undefined,
      listingId: t.listing_id ? String(t.listing_id) : undefined,
    };
  });
  return {
    externalId: String(rc.receipt_id ?? ""),
    buyerFirst, buyerLast,
    addr1: rc.first_line || "", addr2: rc.second_line || "",
    city: rc.city || "", state: rc.state || "", zip: rc.zip || "", country: rc.country_iso || "",
    total: money(rc.grandtotal) || money(rc.total_price),
    fee: 0,
    note: rc.message_from_buyer || "",
    platformStatus: rc.status || "",
    items,
  };
}

// ===== Đẩy tracking ngược lên Etsy (createReceiptShipment) =====
// Etsy nhận carrier_name theo danh sách cố định. Map các hãng POD hay gặp → key Etsy.
export function etsyCarrier(raw: string | null | undefined): string {
  const c = (raw || "").toLowerCase();
  if (/usps|united states postal/.test(c)) return "usps";
  if (/fedex/.test(c)) return "fedex";
  if (/ups/.test(c)) return "ups";
  if (/dhl.*express/.test(c)) return "dhl-express";
  if (/dhl/.test(c)) return "dhl";
  if (/yun.?express|yunexpress/.test(c)) return "yun-express";
  if (/4px/.test(c)) return "4px";
  if (/china.?post/.test(c)) return "china-post";
  if (/china.?ems|ems/.test(c)) return "china-ems";
  if (/cainiao/.test(c)) return "cainiao";
  if (/sf.?express/.test(c)) return "sf-express";
  if (/royal.?mail/.test(c)) return "royal-mail";
  if (/canada.?post/.test(c)) return "canada-post";
  if (/australia.?post|auspost/.test(c)) return "australia-post";
  if (/gls/.test(c)) return "gls";
  if (/dpd/.test(c)) return "dpd";
  if (/hermes|evri/.test(c)) return "hermes";
  return c || "other"; // gửi thô, nếu Etsy không nhận sẽ báo lỗi để người dùng xử lý
}

export async function createReceiptShipment(
  cfg: EtsyCfg,
  receiptId: string,
  opts: { trackingCode: string; carrierName: string; sendBcc?: boolean; noteToBuyer?: string }
) {
  const body = new URLSearchParams({
    tracking_code: opts.trackingCode,
    carrier_name: opts.carrierName,
  });
  if (opts.sendBcc) body.set("send_bcc", "true");
  if (opts.noteToBuyer) body.set("note_to_buyer", opts.noteToBuyer);
  const r = await fetch(`${ETSY_API}/shops/${cfg.shopId}/receipts/${receiptId}/tracking`, {
    method: "POST",
    headers: { "x-api-key": apiKey(cfg), Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `createReceiptShipment failed (${r.status})`);
  return j;
}
