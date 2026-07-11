import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getValidCfg, fetchReceipts, normalizeReceipt } from "@/lib/etsy";
import { insertEtsyOrders } from "@/lib/ingest-etsy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Kéo đơn (receipts) từ Etsy qua Open API v3 chính thức, chuẩn hoá rồi tạo đơn trong FUSION.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "stores")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => ({})) as { storeId?: string };
  if (!b.storeId) return NextResponse.json({ ok: false, error: "missing storeId" }, { status: 400 });

  const [store] = await db.select({
    id: schema.stores.id, sellerId: schema.stores.sellerId, fx: schema.stores.fxRate,
    name: schema.stores.name, c: schema.stores.apiCredentials,
  }).from(schema.stores).where(eq(schema.stores.id, b.storeId)).limit(1);
  if (!store) return NextResponse.json({ ok: false, error: "store not found" }, { status: 404 });

  try {
    const cfg = await getValidCfg(store.id, store.c as Record<string, string> | null);
    if (!cfg.shopId) return NextResponse.json({ ok: false, error: "Store has no shop_id yet — reconnect Etsy." }, { status: 400 });

    const receipts = await fetchReceipts(cfg, 250);
    const orders = receipts.map(normalizeReceipt).filter((o) => o.externalId);
    const r = await insertEtsyOrders({ id: store.id, sellerId: store.sellerId, fx: store.fx, name: store.name }, orders, "api");
    return NextResponse.json({ ok: true, store: store.name, received: orders.length, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 400 });
  }
}
