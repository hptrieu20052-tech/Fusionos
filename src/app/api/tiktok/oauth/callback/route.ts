import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { readTtCfg, writeTtCfg, ttExchangeToken, ttGetAuthorizedShops, theyourlistApp, unwrapTtState } from "@/lib/tiktok-shop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/tiktok/oauth/callback?code=...&state=<storeId>
 * (Redirect URL đăng ký trong app Partner Center: https://os.fusiondn.com/api/tiktok/oauth/callback)
 * Đổi code → token, lấy shop_id + shop_cipher, lưu vào store. Path này cần bypass Cloudflare Access.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") ?? "";
  const rawState = req.nextUrl.searchParams.get("state") ?? "";
  const storeId = unwrapTtState(rawState); // gỡ tiền tố Fusion/legacy nếu có
  const back = (msg: string, ok = false) =>
    NextResponse.redirect(new URL(`/stores?tt=${ok ? "ok" : "err"}&m=${encodeURIComponent(msg)}`, req.nextUrl.origin));
  if (!code || !storeId) return back("missing code/state");

  const [st] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!st) return back("store doesn't exist");
  const cred = st.apiCredentials as Record<string, string> | null;
  const cfg = readTtCfg(cred);

  // App riêng của store (nếu đã lưu) → dùng. Chưa có → dùng app PARTNER theyourlist (env).
  // Phải LƯU cặp key dùng để đổi token vào store, vì refresh token sau này cần đúng cặp đó.
  const partner = theyourlistApp();
  const appKey = cfg.appKey || partner?.appKey || "";
  const appSecret = cfg.appSecret || partner?.appSecret || "";
  if (!appKey || !appSecret) return back("No TikTok app key: set THEYOURLIST_APP_KEY/SECRET or save the store's own App Key/Secret");

  try {
    const t = await ttExchangeToken(appKey, appSecret, { authCode: code });
    // Ghi kèm appKey/appSecret đã dùng (nếu store chưa có) → refresh token về sau chạy đúng app
    let next = writeTtCfg(cred, cfg.appKey ? t : { ...t, appKey, appSecret });
    // Lấy shop authorize (thường 1 shop/lần authorize) → shop_id + cipher cho mọi call sau
    const shops = await ttGetAuthorizedShops(readTtCfg(next));
    if (shops.length) next = writeTtCfg(next, { shopId: shops[0].id, shopCipher: shops[0].cipher, shopName: shops[0].name });
    await db.update(schema.stores).set({ apiCredentials: next, connectMethod: "api" }).where(eq(schema.stores.id, storeId));
    return back(shops[0]?.name ? `connected: ${shops[0].name}` : "connected", true);
  } catch (e) {
    return back(String((e as Error)?.message ?? e).slice(0, 180));
  }
}
