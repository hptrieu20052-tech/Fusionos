import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { writeTtCfg } from "@/lib/tiktok-shop";

export const dynamic = "force-dynamic";

// POST { storeId, appKey, appSecret, authLink? } — lưu app TikTok cho store
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "stores")) < 2) return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.storeId || !b?.appKey || !b?.appSecret) return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });
  const [st] = await db.select().from(schema.stores).where(eq(schema.stores.id, b.storeId)).limit(1);
  if (!st) return NextResponse.json({ ok: false, error: "store doesn't exist" }, { status: 404 });
  let next = writeTtCfg(st.apiCredentials as Record<string, string> | null, { appKey: String(b.appKey).trim(), appSecret: String(b.appSecret).trim() });
  if (typeof b.authLink === "string") next = { ...next, tiktok_auth_link: b.authLink.trim() };
  await db.update(schema.stores).set({ apiCredentials: next }).where(eq(schema.stores.id, b.storeId));
  return NextResponse.json({ ok: true });
}
