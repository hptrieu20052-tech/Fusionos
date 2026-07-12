import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { readTtCfg, writeTtCfg, ttExchangeToken, ttGetAuthorizedShops } from "@/lib/tiktok-shop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { storeId, authCode } — connect THỦ CÔNG bằng auth code (TTP_...).
 * Dùng khi Redirect URL của app trỏ về domain khác (không sửa được) —
 * copy code hiện trên trang redirect rồi dán vào đây. Code sống 30 phút, dùng 1 lần.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "stores")) < 2) return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  const authCode = String(b?.authCode ?? "").trim();
  if (!b?.storeId || !authCode) return NextResponse.json({ ok: false, error: "missing storeId/authCode" }, { status: 400 });

  const [st] = await db.select().from(schema.stores).where(eq(schema.stores.id, b.storeId)).limit(1);
  if (!st) return NextResponse.json({ ok: false, error: "store doesn't exist" }, { status: 404 });
  const cred = st.apiCredentials as Record<string, string> | null;
  const cfg = readTtCfg(cred);
  if (!cfg.appKey || !cfg.appSecret) return NextResponse.json({ ok: false, error: "Save App Key + Secret first" }, { status: 400 });

  try {
    const t = await ttExchangeToken(cfg.appKey, cfg.appSecret, { authCode });
    let next = writeTtCfg(cred, t);
    const shops = await ttGetAuthorizedShops(readTtCfg(next));
    if (shops.length) next = writeTtCfg(next, { shopId: shops[0].id, shopCipher: shops[0].cipher, shopName: shops[0].name });
    await db.update(schema.stores).set({ apiCredentials: next, connectMethod: "api" }).where(eq(schema.stores.id, b.storeId));
    return NextResponse.json({ ok: true, shopName: shops[0]?.name ?? "", shopId: shops[0]?.id ?? "" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
