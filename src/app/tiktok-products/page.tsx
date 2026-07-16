import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { desc, inArray, sql } from "drizzle-orm";
import { storeOwnerScopeIds } from "@/lib/scope";
import TiktokProductsClient from "./products-client";

export const dynamic = "force-dynamic";

export default async function TiktokProductsPage() {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) {
    return <div className="panel empty">You don&apos;t have permission to view Products.</div>;
  }

  // Phạm vi: seller chỉ thấy store MÌNH (store.sellerId ∈ scope) → dropdown shop + bảng product đều bị giới hạn theo đó.
  const scopeIds = await storeOwnerScopeIds(session);
  const storeWhere = scopeIds ? inArray(schema.stores.sellerId, scopeIds) : undefined;
  const stores = await db.select({ id: schema.stores.id, name: schema.stores.name }).from(schema.stores).where(storeWhere);
  const productWhere = scopeIds ? (stores.length ? inArray(schema.tiktokProducts.storeId, stores.map((s) => s.id)) : sql`false`) : undefined;

  const rows = await db.select().from(schema.tiktokProducts)
    .where(productWhere)
    .orderBy(desc(schema.tiktokProducts.ttUpdateTime)).limit(1000);
  const isAdmin = session.role === "admin";
  const canManage = (await levelOf(session, "products")) >= 2; // Clone / Edit cần quyền full
  return <TiktokProductsClient stores={stores} initial={JSON.parse(JSON.stringify(rows))} isAdmin={isAdmin} canManage={canManage} />;
}
