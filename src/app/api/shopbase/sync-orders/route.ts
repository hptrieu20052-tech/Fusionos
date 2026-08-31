import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { insertEtsyOrders } from "@/lib/ingest-etsy";
import { getShopBaseCred, fetchShopBaseOrders, normalizeShopBaseOrder, touchShopBaseSync, shopbaseConfigured } from "@/lib/shopbase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/shopbase/sync-orders { storeId? , days? }
 * Kéo đơn ShopBase qua REST rồi đổ vào bảng orders/order_items chung (platform='shopbase') qua
 * insertEtsyOrders → Product Sales + Video performance tự động sáng. Dedup theo (shopbase, external_id).
 * days: cửa sổ lấy đơn cho lần sync này (mặc định: từ lastSyncAt-1 ngày, hoặc 60 ngày nếu chưa sync).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "stores")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const storeId = typeof b?.storeId === "string" && /^[0-9a-f-]{36}$/i.test(b.storeId) ? b.storeId : undefined;

  const conf = await getShopBaseCred(storeId);
  if (!conf) return NextResponse.json({ ok: false, error: "Chưa có store ShopBase — tạo store ở mục Stores." }, { status: 400 });
  if (!shopbaseConfigured(conf.cred)) {
    return NextResponse.json({ ok: false, error: "ShopBase store chưa cấu hình — nhập Subdomain + API key + Password ở Stores rồi Check." }, { status: 400 });
  }

  const [store] = await db.select({
    id: schema.stores.id, sellerId: schema.stores.sellerId, fx: schema.stores.fxRate, name: schema.stores.name,
  }).from(schema.stores).where(eq(schema.stores.id, conf.storeId)).limit(1);
  if (!store) return NextResponse.json({ ok: false, error: "store not found" }, { status: 404 });

  // Seller chỉ sync store của mình.
  if (session.role === "seller" && store.sellerId !== session.sub) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // Cửa sổ lấy đơn: ưu tiên days do UI truyền; else từ lastSyncAt - 1 ngày (overlap bắt đơn sửa); else 60 ngày.
  const days = Number.isFinite(Number(b?.days)) ? Math.min(Math.max(Number(b.days), 1), 365) : null;
  let createdMin: string;
  if (days) createdMin = new Date(Date.now() - days * 86400_000).toISOString();
  else if (conf.cred.lastSyncAt) createdMin = new Date(new Date(conf.cred.lastSyncAt).getTime() - 86400_000).toISOString();
  else createdMin = new Date(Date.now() - 60 * 86400_000).toISOString();

  let raw: Record<string, unknown>[];
  try {
    raw = await fetchShopBaseOrders(conf.cred, { createdMin });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 250) }, { status: 200 });
  }

  const orders = raw.map(normalizeShopBaseOrder).filter((o) => o.externalId);
  const result = orders.length
    ? await insertEtsyOrders({ id: store.id, sellerId: store.sellerId, fx: store.fx, name: store.name }, orders, "api", "shopbase")
    : { created: 0, updated: 0, skipped: 0, errors: [] as string[] };

  await touchShopBaseSync(conf.storeId);
  return NextResponse.json({ ok: true, fetched: raw.length, ...result });
}
