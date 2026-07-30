import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { storeOwnerScopeIds } from "@/lib/scope";
import ShopifyTemplatesClient from "./templates-client";

export const dynamic = "force-dynamic";

export default async function ShopifyTemplatesPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty">You don&apos;t have permission to view Templates.</div>;
  const lvl = await levelOf(session, "products");
  if (lvl < 2) return <div className="panel empty">You don&apos;t have permission to manage Templates.</div>;

  const scopeIds = await storeOwnerScopeIds(session);
  const where = scopeIds
    ? and(eq(schema.stores.marketplace, "shopify"), inArray(schema.stores.sellerId, scopeIds))
    : eq(schema.stores.marketplace, "shopify");
  const stores = await db.select({ id: schema.stores.id, name: schema.stores.name })
    .from(schema.stores).where(where).orderBy(asc(schema.stores.name));

  return <ShopifyTemplatesClient stores={stores} />;
}
