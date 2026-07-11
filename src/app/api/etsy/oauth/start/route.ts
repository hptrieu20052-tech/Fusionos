import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { readEtsyCfg, makePkce, authorizeUrl } from "@/lib/etsy";

export const dynamic = "force-dynamic";

// Bắt đầu OAuth: dựng URL authorize của Etsy (kèm PKCE) rồi chuyển hướng seller sang Etsy.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "stores")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const storeId = req.nextUrl.searchParams.get("storeId") || "";
  if (!storeId) return NextResponse.json({ ok: false, error: "missing storeId" }, { status: 400 });

  const [store] = await db.select({ c: schema.stores.apiCredentials }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  const cfg = readEtsyCfg(store?.c as Record<string, string> | null);
  if (!cfg.keystring) return NextResponse.json({ ok: false, error: "Store has no keystring yet — enter Keystring + Secret and Save first." }, { status: 400 });

  const { verifier, challenge, state } = makePkce();
  const redirectUri = `${req.nextUrl.origin}/api/etsy/oauth/callback`;
  const url = authorizeUrl(cfg.keystring, redirectUri, challenge, state);

  const res = NextResponse.redirect(url);
  // Lưu tạm PKCE + storeId trong cookie httpOnly (đọc lại ở callback). Sống 10 phút.
  res.cookies.set("etsy_oauth", JSON.stringify({ state, verifier, storeId }), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600,
  });
  return res;
}
