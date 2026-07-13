import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { readEtsyCfg, makePkce, authorizeUrl } from "@/lib/etsy";

export const dynamic = "force-dynamic";

/**
 * Bắt đầu OAuth Etsy (PKCE).
 *
 * GET ?storeId=...        → redirect thẳng sang Etsy (dùng khi shop đang login cùng browser)
 * GET ?storeId=...&copy=1 → trả JSON { url } để copy, dán vào AdsPower nơi shop Etsy đang login
 *
 * PKCE verifier lưu SERVER-SIDE (bảng oauth_pending), tra theo `state` — KHÔNG dùng cookie.
 * Nhờ vậy callback không cần cookie và không cần session Fusion OS ở browser nhận redirect,
 * nên không phải đăng nhập Fusion OS trong AdsPower.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "stores")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const storeId = req.nextUrl.searchParams.get("storeId") || "";
  if (!storeId) return NextResponse.json({ ok: false, error: "missing storeId" }, { status: 400 });
  const wantCopy = req.nextUrl.searchParams.get("copy") === "1";

  const [store] = await db.select({ c: schema.stores.apiCredentials }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  const cfg = readEtsyCfg(store?.c as Record<string, string> | null);
  if (!cfg.keystring) return NextResponse.json({ ok: false, error: "Store has no keystring yet — enter Keystring + Secret and Save first." }, { status: 400 });

  const { verifier, challenge, state } = makePkce();
  const redirectUri = `${req.nextUrl.origin}/api/etsy/oauth/callback`;
  const url = authorizeUrl(cfg.keystring, redirectUri, challenge, state);

  try {
    // Dọn bản ghi quá hạn (10 phút) — bảng luôn nhỏ, không cần cron riêng
    await db.execute(sql`DELETE FROM oauth_pending WHERE created_at < now() - interval '10 minutes'`);
    await db.insert(schema.oauthPending).values({ state, verifier, storeId });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "Run MIGRATION_oauth_pending.sql first — " + String((e as Error)?.message ?? e).slice(0, 120) },
      { status: 500 },
    );
  }

  if (wantCopy) return NextResponse.json({ ok: true, url });
  return NextResponse.redirect(url);
}
