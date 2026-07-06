import { getSession } from "@/lib/auth";
import { can, levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { FulfillClient } from "./fulfill-client";

export const dynamic = "force-dynamic";

export default async function FulfillmentPage() {
  const session = await getSession();
  if (!session || !(await can(session, "fulfillment"))) {
    return <div className="panel empty">Bạn không có quyền xem module Fulfillment.</div>;
  }
  const canPush = (await levelOf(session, "fulfillment")) >= 2;

  const pushed = await db
    .select({
      f: schema.fulfillmentOrders,
      externalId: schema.orders.externalId,
      ffName: schema.fulfillers.name,
    })
    .from(schema.fulfillmentOrders)
    .leftJoin(schema.orders, eq(schema.fulfillmentOrders.orderId, schema.orders.id))
    .leftJoin(schema.fulfillers, eq(schema.fulfillmentOrders.fulfillerId, schema.fulfillers.id))
    .orderBy(desc(schema.fulfillmentOrders.createdAt))
    .limit(50);

  return <FulfillClient canPush={canPush} pushed={pushed.map((p) => ({
    id: p.f.id, externalId: p.externalId, ffName: p.ffName, status: p.f.status,
    cost: p.f.cost, tracking: p.f.trackingNumber, externalFfId: p.f.externalFfId,
  }))} />;
}
