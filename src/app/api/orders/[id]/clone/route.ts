import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf, hasRestriction } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// POST /api/orders/[id]/clone — nhân bản đơn (status new, external_id thêm -CLONE-n)
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const o = (await db.execute(sql`SELECT * FROM orders WHERE id = ${params.id}::uuid`)).rows[0] as Record<string, unknown> | undefined;
  if (!o) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if ((await hasRestriction(session.sub, "own_orders_only")) && o.seller_id !== session.sub) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const n = (await db.execute(sql`SELECT count(*)::int c FROM orders WHERE external_id LIKE ${o.external_id + "-CLONE-%"}`)).rows[0] as { c: number };
  const newExt = `${o.external_id}-CLONE-${n.c + 1}`;

  const [clone] = await db.insert(schema.orders).values({
    externalId: newExt,
    platform: o.platform as never, storeId: o.store_id as string | null, sellerId: o.seller_id as string | null,
    status: "new", platformStatus: o.platform_status as string | null, source: "manual",
    buyerFirst: o.buyer_first as string | null, buyerLast: o.buyer_last as string | null,
    addr1: o.addr1 as string | null, addr2: o.addr2 as string | null, city: o.city as string | null,
    state: o.state as string | null, zip: o.zip as string | null, country: (o.country as string) ?? "United States",
    total: String(o.total), platformFee: String(o.platform_fee), currency: (o.currency as string) ?? "USD",
    orderLabel: o.order_label as string | null, orderedAt: new Date(),
  }).returning();

  await db.execute(sql`
    INSERT INTO order_items (order_id, product_title, internal_sku, qty, unit_price, design_id, special_print, mockup_key)
    SELECT ${clone.id}::uuid, product_title, internal_sku, qty, unit_price, design_id, special_print, mockup_key
    FROM order_items WHERE order_id = ${params.id}::uuid
  `);
  return NextResponse.json({ ok: true, order: clone });
}
