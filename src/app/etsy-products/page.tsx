import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { storeOwnerScopeIds } from "@/lib/scope";
import EtsyProductsClient from "./products-client";

export const dynamic = "force-dynamic";

export default async function EtsyProductsPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty">You don&apos;t have permission to view Products.</div>;
  const lvl = await levelOf(session, "products");
  if (lvl < 1) {
    return <div className="panel empty">You don&apos;t have permission to view Products.</div>;
  }
  // CHỈ store ETSY; seller chỉ thấy store CỦA MÌNH (scope y hệt Manage Products Tiktok)
  const scopeIds = await storeOwnerScopeIds(session);
  const where = scopeIds
    ? and(eq(schema.stores.marketplace, "etsy"), inArray(schema.stores.sellerId, scopeIds))
    : eq(schema.stores.marketplace, "etsy");
  const stores = await db.select({ id: schema.stores.id, name: schema.stores.name })
    .from(schema.stores).where(where).orderBy(asc(schema.stores.name));
  return <EtsyProductsClient stores={stores} canEdit={lvl >= 2} />;
}
