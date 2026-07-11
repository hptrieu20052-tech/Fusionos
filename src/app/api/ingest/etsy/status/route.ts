import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// CORS: extension gọi từ etsy.com
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// POST { externalIds: string[] } + Bearer <store ingest_token>
// → trạng thái đơn + tracking (để extension hiển thị lên giao diện Etsy, giúp biết đơn nào cần add tracking).
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "missing token" }, 401);

  const [store] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.ingestToken, token)).limit(1);
  if (!store) return json({ ok: false, error: "invalid token" }, 401);

  const body = await req.json().catch(() => null) as { externalIds?: string[] } | null;
  const ids = Array.isArray(body?.externalIds) ? body!.externalIds.map(String).filter(Boolean).slice(0, 300) : [];
  if (!ids.length) return json({ ok: true, orders: {} });

  const rows = await db.select({
    externalId: schema.orders.externalId,
    status: schema.orders.status,
    orderId: schema.orders.id,
  }).from(schema.orders).where(and(
    eq(schema.orders.platform, "etsy" as never),
    eq(schema.orders.storeId, store.id),
    inArray(schema.orders.externalId, ids),
  ));

  const out: Record<string, { status: string; tracking: string | null; carrier: string | null; trackingUrl: string | null; hasTracking: boolean; pushedToEtsy: boolean }> = {};
  for (const o of rows) {
    // bản ghi fulfill mới nhất có tracking
    const [ffo] = await db.select({
      tracking: schema.fulfillmentOrders.trackingNumber,
      carrier: schema.fulfillmentOrders.trackingCarrier,
      url: schema.fulfillmentOrders.trackingUrl,
      pushed: schema.fulfillmentOrders.etsyTrackingPushedAt,
    }).from(schema.fulfillmentOrders)
      .where(eq(schema.fulfillmentOrders.orderId, o.orderId))
      .orderBy(desc(schema.fulfillmentOrders.createdAt)).limit(1);
    out[o.externalId] = {
      status: o.status,
      tracking: ffo?.tracking ?? null,
      carrier: ffo?.carrier ?? null,
      trackingUrl: ffo?.url ?? null,
      hasTracking: !!ffo?.tracking,
      pushedToEtsy: !!ffo?.pushed,
    };
  }
  return json({ ok: true, orders: out });
}
