import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, getMe, readEtsyCfg, saveEtsyCfg } from "@/lib/etsy";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

// Etsy chuyển hướng về đây kèm code + state. Đổi code → token, lấy shop_id, lưu lại.
export async function GET(req: NextRequest) {
  const done = (ok: boolean, msg: string) =>
    NextResponse.redirect(`${req.nextUrl.origin}/stores?etsy=${ok ? "ok" : "err"}&msg=${encodeURIComponent(msg)}`);

  const code = req.nextUrl.searchParams.get("code") || "";
  const state = req.nextUrl.searchParams.get("state") || "";
  if (!code || !state) return done(false, "Missing code/state");

  // PKCE verifier lấy từ DB theo `state` (không dùng cookie) → callback chạy được ở BẤT KỲ browser nào,
  // kể cả AdsPower chưa từng đăng nhập Fusion OS. `state` dùng 1 lần, hết hạn 10 phút.
  const rows = (await db.execute(sql`
    DELETE FROM oauth_pending
    WHERE state = ${state} AND created_at > now() - interval '10 minutes'
    RETURNING verifier, store_id
  `)).rows as { verifier: string; store_id: string }[];
  if (!rows.length) return done(false, "Link expired or already used — click Copy connect link again");
  const saved = { verifier: rows[0].verifier, storeId: rows[0].store_id };

  try {
    const [store] = await db.select({ c: schema.stores.apiCredentials }).from(schema.stores).where(eq(schema.stores.id, saved.storeId)).limit(1);
    const cfg = readEtsyCfg(store?.c as Record<string, string> | null);
    if (!cfg.keystring) return done(false, "Store missing keystring");

    const redirectUri = `${req.nextUrl.origin}/api/etsy/oauth/callback`;
    const tok = await exchangeCode(cfg.keystring, code, saved.verifier, redirectUri);
    cfg.accessToken = tok.access_token;
    cfg.refreshToken = tok.refresh_token;

    const me = await getMe(cfg);
    await saveEtsyCfg(saved.storeId, {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: Date.now() + (tok.expires_in || 3600) * 1000,
      shopId: me.shopId,
    });

    return done(true, "Connected to Etsy");
  } catch (e) {
    return done(false, String((e as Error)?.message ?? e).slice(0, 160));
  }
}
