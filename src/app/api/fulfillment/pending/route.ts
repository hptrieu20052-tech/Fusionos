import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// GET — đơn chờ đẩy (status=new) + tình trạng mapping SKU theo từng fulfiller
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "fulfillment")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const orders = await db.select().from(schema.orders).where(eq(schema.orders.status, "new")).orderBy(desc(schema.orders.orderedAt)).limit(100);
  const ids = orders.map((o) => o.id);
  const items = ids.length ? await db.select().from(schema.orderItems).where(inArray(schema.orderItems.orderId, ids)) : [];
  const fulfillers = await db.select().from(schema.fulfillers);
  const mappings = await db.select().from(schema.skuMappings).where(eq(schema.skuMappings.active, true));

  const out = orders.map((o) => {
    const its = items.filter((i) => i.orderId === o.id);
    const options = fulfillers.map((f) => {
      const lines = its.map((it) => {
        const m = mappings.find((x) => x.internalSku === it.internalSku && x.fulfillerId === f.id);
        return m ? { sku: it.internalSku, qty: it.qty, cost: (Number(m.baseCost) + Number(m.shipCost)) * it.qty } : null;
      });
      const full = lines.every(Boolean);
      return {
        fulfillerId: f.id, name: f.name, method: f.method, mapped: full,
        estCost: full ? lines.reduce((t, l) => t + l!.cost, 0) : null,
      };
    });
    return { ...o, items: its, fulfillerOptions: options };
  });
  return NextResponse.json({ ok: true, orders: out });
}
