import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { ttGetValidCfg, ttSearchOrders, ttNormalizeOrder } from "@/lib/tiktok-shop";
import { insertEtsyOrders } from "@/lib/ingest-etsy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/tiktok/pull { storeId } — kéo đơn TikTok 7 ngày gần nhất qua Open API
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "orders")) < 2) return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.storeId) return NextResponse.json({ ok: false, error: "missing storeId" }, { status: 400 });

  const [st] = await db.select().from(schema.stores).where(eq(schema.stores.id, b.storeId)).limit(1);
  if (!st) return NextResponse.json({ ok: false, error: "store doesn't exist" }, { status: 404 });

  try {
    const cfg = await ttGetValidCfg(st.id, st.apiCredentials as Record<string, string> | null);
    const raw = await ttSearchOrders(cfg, { pageSize: 50 });
    const orders = raw.map(ttNormalizeOrder).filter((o) => o.externalId);
    const r = await insertEtsyOrders({ id: st.id, sellerId: st.sellerId, fx: st.fxRate, name: st.name }, orders, "api", "tiktok");
    return NextResponse.json({ ok: true, received: orders.length, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
