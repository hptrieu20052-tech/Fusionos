import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { storeOwnerScopeIds } from "@/lib/scope";
import LabelsClient from "./labels-client";

export const dynamic = "force-dynamic";

// v404 · Feed Labels — quản lý custom_label_0 của feed GMC theo collection.
// Quyền: module products (1 = xem, 2 = sửa). Seller chỉ thấy store của mình.
export default async function FeedLabelsPage() {
  const session = await getSession();
  const level = session ? await levelOf(session, "products") : 0;
  if (!session || level < 1) {
    return <div className="panel empty">You don&apos;t have permission to view Feed Labels.</div>;
  }
  const scopeIds = await storeOwnerScopeIds(session);
  const conds = [eq(schema.stores.marketplace, "shopify")];
  if (scopeIds) conds.push(inArray(schema.stores.sellerId, scopeIds));
  const stores = await db.select({ id: schema.stores.id, name: schema.stores.name })
    .from(schema.stores).where(and(...conds));
  return <LabelsClient stores={JSON.parse(JSON.stringify(stores))} canEdit={level >= 2} />;
}
