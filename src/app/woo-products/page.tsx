import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { storeOwnerScopeIds } from "@/lib/scope";
import WooProductsClient from "./products-client";

export const dynamic = "force-dynamic";

export default async function WooProductsPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty">You don&apos;t have permission to view Products.</div>;
  const lvl = await levelOf(session, "products");
  if (lvl < 1) return <div className="panel empty">You don&apos;t have permission to view Products.</div>;

  // CHỈ store WOOCOMMERCE; seller chỉ thấy store của mình.
  const scopeIds = await storeOwnerScopeIds(session);
  const where = scopeIds
    ? and(eq(schema.stores.marketplace, "woocommerce"), or(isNull(schema.stores.sellerId), inArray(schema.stores.sellerId, scopeIds)))
    : eq(schema.stores.marketplace, "woocommerce");   // sellerId NULL = store chung
  const stores = await db.select({
    id: schema.stores.id, name: schema.stores.name,
    sellerId: schema.stores.sellerId, sellerName: schema.users.fullName,
  }).from(schema.stores)
    .leftJoin(schema.users, eq(schema.users.id, schema.stores.sellerId))
    .where(where).orderBy(asc(schema.stores.name));

  return <WooProductsClient stores={stores} canEdit={lvl >= 2} />;
}
