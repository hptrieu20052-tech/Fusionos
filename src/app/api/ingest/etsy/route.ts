import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { insertEtsyOrders, type InOrder } from "@/lib/ingest-etsy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// CORS: Extension calls from etsy.com (different origin) → allow cross-origin + Bearer auth.
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

export async function POST(req: NextRequest) {
  // Auth: Authorization: Bearer <store ingest_token>
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "missing token" }, 401);

  const [store] = await db.select({ id: schema.stores.id, sellerId: schema.stores.sellerId, fx: schema.stores.fxRate, name: schema.stores.name })
    .from(schema.stores).where(eq(schema.stores.ingestToken, token)).limit(1);
  if (!store) return json({ ok: false, error: "invalid token" }, 401);

  const body = await req.json().catch(() => null) as { orders?: InOrder[] } | null;
  const orders = Array.isArray(body?.orders) ? body!.orders : [];
  if (!orders.length) return json({ ok: false, error: "no orders" }, 400);

  const r = await insertEtsyOrders(store, orders, "extension");
  return json({ ok: true, store: store.name, received: orders.length, ...r });
}
