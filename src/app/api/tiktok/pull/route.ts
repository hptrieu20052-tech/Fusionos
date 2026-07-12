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
    const since = Math.floor(Date.now() / 1000) - 30 * 86400;
    const raw = await ttSearchOrders(cfg, { pageSize: 50, createdAfter: since });
    const orders = raw.map(ttNormalizeOrder).filter((o) => o.externalId);
    const r = await insertEtsyOrders({ id: st.id, sellerId: st.sellerId, fx: st.fxRate, name: st.name }, orders, "api", "tiktok");
    // 0 đơn to-ship → soi mọi trạng thái để báo cho rõ (shop trống hay chỉ là hết đơn chờ ship)
    let hint: string | undefined;
    if (!orders.length) {
      const all = await ttSearchOrders(cfg, { pageSize: 50, createdAfter: since, status: null });
      if (!all.length) hint = "Shop has no orders in the last 30 days.";
      else {
        const byStatus: Record<string, number> = {};
        for (const o of all) { const k = String(o.status ?? "?"); byStatus[k] = (byStatus[k] ?? 0) + 1; }
        hint = `No AWAITING_SHIPMENT orders — found ${all.length} in other statuses: ` +
          Object.entries(byStatus).map(([k, v]) => `${k}: ${v}`).join(", ") +
          ". Shipped/completed orders are intentionally filtered out (old-system cutover).";
      }
    }
    return NextResponse.json({ ok: true, received: orders.length, ...r, hint });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
