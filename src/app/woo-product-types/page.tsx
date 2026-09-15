import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { storeOwnerScopeIds, sharedStoreIds } from "@/lib/scope";
import WooProductTypesClient from "./product-types-client";

export const dynamic = "force-dynamic";

export default async function WooProductTypesPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty">You don&apos;t have permission to view Product Types.</div>;
  const lvl = await levelOf(session, "products");
  if (lvl < 1) return <div className="panel empty">You don&apos;t have permission to view Product Types.</div>;

  const scopeIds = await storeOwnerScopeIds(session);
  const shared = await sharedStoreIds(scopeIds);
  const where = scopeIds
    ? and(eq(schema.stores.marketplace, "woocommerce"), or(
        isNull(schema.stores.sellerId),
        inArray(schema.stores.sellerId, scopeIds),
        ...(shared.length ? [inArray(schema.stores.id, shared)] : []),
      ))
    : eq(schema.stores.marketplace, "woocommerce");
  const stores = await db.select({
    id: schema.stores.id, name: schema.stores.name,
  }).from(schema.stores).where(where).orderBy(asc(schema.stores.name));

  return <WooProductTypesClient stores={stores} canEdit={lvl >= 2} />;
}
