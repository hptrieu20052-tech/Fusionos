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
  // Kèm seller (chủ store) để admin lọc theo seller — seller thường thì list chỉ có store của mình.
  const stores = await db.select({
    id: schema.stores.id, name: schema.stores.name,
    sellerId: schema.stores.sellerId, sellerName: schema.users.fullName,
  }).from(schema.stores)
    .leftJoin(schema.users, eq(schema.users.id, schema.stores.sellerId))
    .where(where).orderBy(asc(schema.stores.name));
  // Danh sách seller duy nhất (chỉ hiện filter cho admin/quản lý thấy > 1 seller)
  const sellerMap = new Map<string, string>();
  for (const s of stores) if (s.sellerId) sellerMap.set(s.sellerId, s.sellerName ?? "—");
  const sellers = Array.from(sellerMap, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  // Store SHOPIFY (đích để Push to Shopify qua API) — cùng scope seller.
  const shopWhere = scopeIds
    ? and(eq(schema.stores.marketplace, "shopify"), inArray(schema.stores.sellerId, scopeIds))
    : eq(schema.stores.marketplace, "shopify");
  const shopifyStores = await db.select({ id: schema.stores.id, name: schema.stores.name, sellerId: schema.stores.sellerId })
    .from(schema.stores).where(shopWhere).orderBy(asc(schema.stores.name));
  return <EtsyProductsClient stores={stores} sellers={sellers} shopifyStores={shopifyStores} canEdit={lvl >= 2} />;
}
