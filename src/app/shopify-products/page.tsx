import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { storeOwnerScopeIds } from "@/lib/scope";
import ShopifyProductsClient from "./products-client";

export const dynamic = "force-dynamic";

export default async function ShopifyProductsPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty">You don&apos;t have permission to view Products.</div>;
  const lvl = await levelOf(session, "products");
  if (lvl < 1) return <div className="panel empty">You don&apos;t have permission to view Products.</div>;

  // CHỈ store SHOPIFY; seller chỉ thấy store của mình.
  const scopeIds = await storeOwnerScopeIds(session);
  const where = scopeIds
    ? and(eq(schema.stores.marketplace, "shopify"), inArray(schema.stores.sellerId, scopeIds))
    : eq(schema.stores.marketplace, "shopify");
  const stores = await db.select({
    id: schema.stores.id, name: schema.stores.name,
    sellerId: schema.stores.sellerId, sellerName: schema.users.fullName,
  }).from(schema.stores)
    .leftJoin(schema.users, eq(schema.users.id, schema.stores.sellerId))
    .where(where).orderBy(asc(schema.stores.name));
  const sellerMap = new Map<string, string>();
  for (const s of stores) if (s.sellerId) sellerMap.set(s.sellerId, s.sellerName ?? "—");
  const sellers = Array.from(sellerMap, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  return <ShopifyProductsClient stores={stores} sellers={sellers} canEdit={lvl >= 2} isAdmin={session.role === "admin"} />;
}
