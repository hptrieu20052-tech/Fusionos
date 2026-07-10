import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// CORS: Extension gọi từ trang etsy.com (origin khác) → cần cho phép cross-origin + xác thực bằng Bearer token.
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

type InItem = {
  title?: string; sku?: string; qty?: number; price?: number;
  variant?: string; personalization?: string; listingId?: string; productUrl?: string; imageUrl?: string;
};
type InOrder = {
  externalId?: string; buyerFirst?: string; buyerLast?: string;
  addr1?: string; addr2?: string; city?: string; state?: string; zip?: string; country?: string;
  total?: number; fee?: number; orderedAt?: string; note?: string; platformStatus?: string;
  items?: InItem[];
};

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };

export async function POST(req: NextRequest) {
  // Xác thực: Authorization: Bearer <ingest_token của store>
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "missing token" }, 401);

  const [store] = await db.select({ id: schema.stores.id, sellerId: schema.stores.sellerId, fx: schema.stores.fxRate, name: schema.stores.name })
    .from(schema.stores).where(eq(schema.stores.ingestToken, token)).limit(1);
  if (!store) return json({ ok: false, error: "invalid token" }, 401);

  const body = await req.json().catch(() => null) as { orders?: InOrder[] } | null;
  const orders = Array.isArray(body?.orders) ? body!.orders : [];
  if (!orders.length) return json({ ok: false, error: "no orders" }, 400);

  const fx = Number(store.fx) > 0 ? Number(store.fx) : 1;
  let created = 0, skipped = 0;
  const errors: string[] = [];

  for (const o of orders.slice(0, 500)) {
    const ext = s(o.externalId);
    if (!ext) { skipped++; continue; }
    try {
      const [dup] = await db.select({ id: schema.orders.id }).from(schema.orders)
        .where(and(eq(schema.orders.platform, "etsy" as never), eq(schema.orders.externalId, ext))).limit(1);
      if (dup) { skipped++; continue; }

      const items = Array.isArray(o.items) ? o.items : [];
      const subtotal = items.reduce((a, it) => a + num(it.price) * (num(it.qty) || 1), 0);
      const total = num(o.total) || subtotal;

      const [order] = await db.insert(schema.orders).values({
        externalId: ext, platform: "etsy" as never,
        storeId: store.id, sellerId: store.sellerId, source: "extension" as never, status: "new",
        platformStatus: s(o.platformStatus),
        buyerFirst: s(o.buyerFirst), buyerLast: s(o.buyerLast),
        addr1: s(o.addr1), addr2: s(o.addr2), city: s(o.city), state: s(o.state), zip: s(o.zip),
        country: s(o.country) ?? "United States",
        total: (total / fx).toFixed(2), platformFee: (num(o.fee) / fx).toFixed(2),
        note: s(o.note),
        // Dùng NGÀY KÉO ĐƠN (thời điểm ingest) để mọi thống kê tính theo ngày kéo, không phải ngày khách mua.
        orderedAt: new Date(),
      }).returning();

      const rows = items.length ? items : [{ title: `Đơn Etsy ${ext}`, qty: 1, price: total } as InItem];
      for (const it of rows) {
        await db.insert(schema.orderItems).values({
          orderId: order.id,
          productTitle: s(it.title) ?? `Đơn Etsy ${ext}`,
          internalSku: s(it.sku),
          qty: num(it.qty) || 1,
          unitPrice: (num(it.price) / fx).toFixed(2),
          variant: s(it.variant),
          personalization: s(it.personalization),
          etsyListingId: s(it.listingId),
          productUrl: s(it.productUrl),
          imageUrl: s(it.imageUrl),
        });
      }
      created++;
    } catch (e) {
      errors.push(`${ext}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
  }

  await db.update(schema.stores).set({ lastSyncAt: new Date() }).where(eq(schema.stores.id, store.id));
  return json({ ok: true, store: store.name, received: orders.length, created, skipped, errors: errors.slice(0, 20) });
}
