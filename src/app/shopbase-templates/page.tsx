import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { storeOwnerScopeIds } from "@/lib/scope";
import ShopbaseTemplatesClient from "./templates-client";

export const dynamic = "force-dynamic";

// v405 · Manage Templates · ShopBase — preset options/variants/giá + collections cho flow
// Push Etsy/TikTok → ShopBase. Seller chỉ thấy store CỦA MÌNH (scope y hệt Manage Products).
export default async function ShopbaseTemplatesPage() {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) {
    return <div className="panel empty">You don&apos;t have permission to view Templates.</div>;
  }
  const scopeIds = await storeOwnerScopeIds(session);
  const where = scopeIds
    ? and(eq(schema.stores.marketplace, "shopbase"), inArray(schema.stores.sellerId, scopeIds))
    : eq(schema.stores.marketplace, "shopbase");
  const stores = await db.select({ id: schema.stores.id, name: schema.stores.name })
    .from(schema.stores).where(where).orderBy(asc(schema.stores.name));
  return <ShopbaseTemplatesClient stores={JSON.parse(JSON.stringify(stores))} />;
}
