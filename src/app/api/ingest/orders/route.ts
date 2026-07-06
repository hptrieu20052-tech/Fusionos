import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Marketplace = (typeof schema.orders.platform.enumValues)[number];
type Source = (typeof schema.orders.source.enumValues)[number];

interface IngestItem { productTitle?: string; internalSku?: string; qty?: number; unitPrice?: number }
interface IngestOrder {
  externalId: string | number;
  orderedAt?: string;
  total?: number;
  platformFee?: number;
  platformStatus?: string;
  buyer?: { first?: string; last?: string; addr1?: string; addr2?: string; city?: string; state?: string; zip?: string; country?: string };
  items?: IngestItem[];
}

/**
 * POST /api/ingest/orders — Extension / Excel / webhook gửi đơn về.
 * Header: x-api-key: <INGEST_API_KEY>
 * Dedup theo UNIQUE(platform, external_id): có rồi thì update, không tạo trùng.
 */
export async function POST(req: NextRequest) {
  if (req.headers.get("x-api-key") !== process.env.INGEST_API_KEY) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const platform = body?.platform as Marketplace | undefined;
  if (!platform || !(schema.orders.platform.enumValues as readonly string[]).includes(platform) || !Array.isArray(body.orders)) {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
  const source: Source = (schema.orders.source.enumValues as readonly string[]).includes(body.source)
    ? body.source
    : "extension";

  // Gắn store/seller nếu client gửi storeName
  let store: { id: string; sellerId: string | null } | undefined;
  if (body.storeName) {
    const [s] = await db
      .select({ id: schema.stores.id, sellerId: schema.stores.sellerId })
      .from(schema.stores)
      .where(and(eq(schema.stores.name, body.storeName), eq(schema.stores.marketplace, platform)))
      .limit(1);
    store = s;
  }

  let created = 0, updated = 0, failed = 0;

  for (const o of body.orders as IngestOrder[]) {
    if (!o?.externalId) { failed++; continue; }
    const externalId = String(o.externalId);
    try {
      const patch = {
        platformStatus: o.platformStatus,
        total: o.total != null ? String(o.total) : undefined,
        platformFee: o.platformFee != null ? String(o.platformFee) : undefined,
        buyerFirst: o.buyer?.first,
        buyerLast: o.buyer?.last,
        addr1: o.buyer?.addr1,
        addr2: o.buyer?.addr2,
        city: o.buyer?.city,
        state: o.buyer?.state,
        zip: o.buyer?.zip,
        country: o.buyer?.country,
        updatedAt: new Date(),
      };

      const [existing] = await db
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(and(eq(schema.orders.platform, platform), eq(schema.orders.externalId, externalId)))
        .limit(1);

      if (existing) {
        await db.update(schema.orders).set(patch).where(eq(schema.orders.id, existing.id));
        updated++;
      } else {
        const [ins] = await db
          .insert(schema.orders)
          .values({
            externalId,
            platform,
            source,
            orderedAt: o.orderedAt ? new Date(o.orderedAt) : new Date(),
            storeId: store?.id,
            sellerId: store?.sellerId ?? undefined,
            ...patch,
          })
          .returning({ id: schema.orders.id });

        if (o.items?.length) {
          await db.insert(schema.orderItems).values(
            o.items.map((it) => ({
              orderId: ins.id,
              productTitle: it.productTitle ?? "Unknown",
              internalSku: it.internalSku,
              qty: it.qty ?? 1,
              unitPrice: String(it.unitPrice ?? 0),
            }))
          );
        }
        created++;
      }
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, created, updated, failed });
}
