import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, getMe, readEtsyCfg, saveEtsyCfg } from "@/lib/etsy";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// Etsy chuyển hướng về đây kèm code + state. Đổi code → token, lấy shop_id, lưu lại.
export async function GET(req: NextRequest) {
  const done = (ok: boolean, msg: string) =>
    NextResponse.redirect(`${req.nextUrl.origin}/stores?etsy=${ok ? "ok" : "err"}&msg=${encodeURIComponent(msg)}`);

  const code = req.nextUrl.searchParams.get("code") || "";
  const state = req.nextUrl.searchParams.get("state") || "";
  const raw = req.cookies.get("etsy_oauth")?.value || "";
  if (!code || !state || !raw) return done(false, "Missing code/state");

  let saved: { state: string; verifier: string; storeId: string };
  try { saved = JSON.parse(raw); } catch { return done(false, "Bad session"); }
  if (saved.state !== state) return done(false, "State mismatch");

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

    const res = done(true, "Connected to Etsy");
    res.cookies.delete("etsy_oauth");
    return res;
  } catch (e) {
    return done(false, String((e as Error)?.message ?? e).slice(0, 160));
  }
}
