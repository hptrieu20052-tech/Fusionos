import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { storeOwnerScopeIds } from "@/lib/scope";
import ShopbaseCollectionsClient from "./collections-client";

export const dynamic = "force-dynamic";

// v405 · Manage Collections · ShopBase — tạo/xoá collection, thêm/bớt listing ngay trong FUSION.
// Quyền: module products (1 = xem, 2 = sửa). Seller chỉ thấy store CỦA MÌNH.
export default async function ShopbaseCollectionsPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty">You don&apos;t have permission to view Collections.</div>;
  const lvl = await levelOf(session, "products");
  if (lvl < 1) return <div className="panel empty">You don&apos;t have permission to view Collections.</div>;

  const scopeIds = await storeOwnerScopeIds(session);
  const where = scopeIds
    ? and(eq(schema.stores.marketplace, "shopbase"), or(isNull(schema.stores.sellerId), inArray(schema.stores.sellerId, scopeIds)))
    : eq(schema.stores.marketplace, "shopbase");   // sellerId NULL = store chung
  const stores = await db.select({ id: schema.stores.id, name: schema.stores.name })
    .from(schema.stores).where(where).orderBy(asc(schema.stores.name));
  return <ShopbaseCollectionsClient stores={JSON.parse(JSON.stringify(stores))} canEdit={lvl >= 2} />;
}
