import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { readTtCfg, writeTtCfg, ttExchangeToken, ttGetAuthorizedShops, theyourlistApp, unwrapTtState } from "@/lib/tiktok-shop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ĐIỂM NHẬN OAuth TikTok khi dùng APP CHUNG của theyourlist.
 *
 * Luồng: bấm Connect → TikTok → redirect về auth.theyourlist.com (redirect URI của APP HỌ)
 *        → theyourlist forward NGUYÊN { code, state } về đây.
 *   state = storeId (theyourlist giữ nguyên).
 *   Fusion đổi code → token bằng appKey/appSecret của theyourlist (env THEYOURLIST_APP_KEY/SECRET),
 *   và LƯU cặp key đó vào store để refresh token về sau chạy đúng app.
 *
 * Hỗ trợ cả GET (redirect trực tiếp từ trình duyệt) lẫn POST (server theyourlist gọi).
 * Path này phải bypass Cloudflare Access (thêm vào allowlist nếu có).
 */
async function handle(code: string, rawState: string, origin: string, wantJson: boolean) {
  // theyourlist forward state NGUYÊN (fso_<storeId>) → gỡ tiền tố để lấy storeId thật
  const storeId = unwrapTtState(rawState);
  const redirectBack = (msg: string, ok = false) =>
    NextResponse.redirect(new URL(`/stores?tt=${ok ? "ok" : "err"}&m=${encodeURIComponent(msg)}`, origin));
  const jsonBack = (msg: string, ok = false) =>
    NextResponse.json({ ok, message: msg }, { status: ok ? 200 : 400 });
  const back = (msg: string, ok = false) => (wantJson ? jsonBack(msg, ok) : redirectBack(msg, ok));

  if (!code || !storeId) return back("missing code/state");

  // BỌC TOÀN BỘ trong try để KHÔNG BAO GIỜ trả HTTP 500 trần — theyourlist cần response sạch.
  try {
    // storeId phải là UUID hợp lệ, nếu không db.select ném lỗi (đó là nguồn 500 khi test bằng "abc")
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId)) {
      return back(`bad store id in state: ${storeId}`);
    }
    const [st] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    if (!st) return back("store doesn't exist");
    const cred = st.apiCredentials as Record<string, string> | null;
    const cfg = readTtCfg(cred);

    const partner = theyourlistApp();
    const appKey = cfg.appKey || partner?.appKey || "";
    const appSecret = cfg.appSecret || partner?.appSecret || "";
    if (!appKey || !appSecret) return back("No TikTok app key: set THEYOURLIST_APP_KEY/SECRET env");

    const t = await ttExchangeToken(appKey, appSecret, { authCode: code });
    let next = writeTtCfg(cred, cfg.appKey ? t : { ...t, appKey, appSecret });
    const shops = await ttGetAuthorizedShops(readTtCfg(next));
    if (shops.length) next = writeTtCfg(next, { shopId: shops[0].id, shopCipher: shops[0].cipher, shopName: shops[0].name });
    await db.update(schema.stores).set({ apiCredentials: next, connectMethod: "api" }).where(eq(schema.stores.id, storeId));
    return back(shops[0]?.name ? `connected: ${shops[0].name}` : "connected", true);
  } catch (e) {
    console.error("[tiktokshops/auth] error:", e);
    return back(String((e as Error)?.message ?? e).slice(0, 180));
  }
}

// theyourlist có thể đặt tên tham số khác nhau → dò nhiều biến thể.
const pickParam = (sp: URLSearchParams, names: string[]) => {
  for (const n of names) { const v = sp.get(n); if (v) return v; }
  return "";
};
const CODE_KEYS = ["code", "auth_code", "authorization_code", "authCode"];
const STATE_KEYS = ["state", "st", "shop_state"];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = pickParam(sp, CODE_KEYS);
  const state = pickParam(sp, STATE_KEYS);
  // DEBUG: nếu thiếu code/state, đính kèm danh sách key nhận được để biết theyourlist gửi tên gì
  if (!code || !state) {
    const keys = Array.from(sp.keys()).join(",") || "(none)";
    return NextResponse.redirect(new URL(`/stores?tt=err&m=${encodeURIComponent("missing code/state · got keys: " + keys)}`, req.nextUrl.origin));
  }
  return handle(code, state, req.nextUrl.origin, false);
}

export async function POST(req: NextRequest) {
  // theyourlist server gọi POST → nhận code/state từ body (json hoặc form) hoặc query
  const sp = req.nextUrl.searchParams;
  let code = pickParam(sp, CODE_KEYS);
  let state = pickParam(sp, STATE_KEYS);
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const b = await req.json().catch(() => ({})) as Record<string, string>;
      code = code || CODE_KEYS.map((k) => b[k]).find(Boolean) || "";
      state = state || STATE_KEYS.map((k) => b[k]).find(Boolean) || "";
    } else {
      const f = await req.formData().catch(() => null);
      if (f) {
        code = code || CODE_KEYS.map((k) => String(f.get(k) ?? "")).find(Boolean) || "";
        state = state || STATE_KEYS.map((k) => String(f.get(k) ?? "")).find(Boolean) || "";
      }
    }
  } catch { /* dùng query */ }
  // Server-to-server → trả JSON
  return handle(code, state, req.nextUrl.origin, true);
}
