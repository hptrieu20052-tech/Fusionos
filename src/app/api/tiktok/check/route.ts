import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { ttGetValidCfg, ttGetAuthorizedShops } from "@/lib/tiktok-shop";

export const dynamic = "force-dynamic";

// POST { storeId } — kiểm tra kết nối TikTok: refresh token nếu cần + gọi API shops thật
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "stores")) < 1) return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.storeId) return NextResponse.json({ ok: false, error: "missing storeId" }, { status: 400 });
  const [st] = await db.select().from(schema.stores).where(eq(schema.stores.id, b.storeId)).limit(1);
  if (!st) return NextResponse.json({ ok: false, error: "store doesn't exist" }, { status: 404 });
  try {
    const cfg = await ttGetValidCfg(st.id, st.apiCredentials as Record<string, string> | null);
    const shops = await ttGetAuthorizedShops(cfg);
    return NextResponse.json({ ok: true, shops: shops.map((s) => ({ id: s.id, name: s.name, region: s.region })) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
