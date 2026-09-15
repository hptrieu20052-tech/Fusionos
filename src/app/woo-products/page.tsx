import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { storeOwnerScopeIds, sharedStoreIds } from "@/lib/scope";
import WooProductsClient from "./products-client";

export const dynamic = "force-dynamic";

export default async function WooProductsPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty">You don&apos;t have permission to view Products.</div>;
  const lvl = await levelOf(session, "products");
  if (lvl < 1) return <div className="panel empty">You don&apos;t have permission to view Products.</div>;

  // CHỈ store WOOCOMMERCE; seller chỉ thấy store của mình.
  const scopeIds = await storeOwnerScopeIds(session);
  const shared = await sharedStoreIds(scopeIds);      // store được SHARE (store_members) cũng thấy
  const where = scopeIds
    ? and(eq(schema.stores.marketplace, "woocommerce"), or(
        isNull(schema.stores.sellerId),
        inArray(schema.stores.sellerId, scopeIds),
        ...(shared.length ? [inArray(schema.stores.id, shared)] : []),
      ))
    : eq(schema.stores.marketplace, "woocommerce");   // sellerId NULL = store chung
  const stores = await db.select({
    id: schema.stores.id, name: schema.stores.name,
    sellerId: schema.stores.sellerId, sellerName: schema.users.fullName,
  }).from(schema.stores)
    .leftJoin(schema.users, eq(schema.users.id, schema.stores.sellerId))
    .where(where).orderBy(asc(schema.stores.name));

  // v504 · danh sách seller cho bộ lọc "All sellers": chủ store + seller được share.
  const sellerMap = new Map<string, string>();
  for (const st of stores) if (st.sellerId) sellerMap.set(st.sellerId, st.sellerName ?? "—");
  try {
    const storeIds = stores.map((st) => st.id);
    if (storeIds.length) {
      const mems = await db.select({ userId: schema.storeMembers.userId, name: schema.users.fullName })
        .from(schema.storeMembers)
        .leftJoin(schema.users, eq(schema.users.id, schema.storeMembers.userId))
        .where(inArray(schema.storeMembers.storeId, storeIds));
      for (const m of mems) sellerMap.set(m.userId, m.name ?? "—");
    }
  } catch { /* bảng store_members chưa migrate → chỉ chủ store */ }
  const sellers = Array.from(sellerMap, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  return <WooProductsClient stores={stores} sellers={sellers} canEdit={lvl >= 2} />;
}
