import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { and, inArray } from "drizzle-orm";
import { storeOwnerScopeIds } from "@/lib/scope";
import { ProductSalesClient } from "./products-client";

export const dynamic = "force-dynamic";

// Product sales grouped by listing — to prioritize which designs to run ads on.
// Seller sees only their own products; admin sees all.
export default async function ProductSalesPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty" style={{ padding: 40, textAlign: "center" }}>Sign in required.</div>;
  const isAdmin = session.role === "admin";
  const ok = isAdmin || (await levelOf(session, "products")) >= 1 || (await levelOf(session, "orders")) >= 1;
  if (!ok) return <div className="panel empty" style={{ padding: 40, textAlign: "center" }}>You do not have access to this page.</div>;

  // Danh sách store/seller cho bộ lọc — theo scope (seller chỉ store mình, admin tất cả).
  const scopeIds = await storeOwnerScopeIds(session);
  const conds = scopeIds ? [inArray(schema.stores.sellerId, scopeIds)] : [];
  const storeRows = await db.select({ id: schema.stores.id, name: schema.stores.name, sellerId: schema.stores.sellerId, marketplace: schema.stores.marketplace })
    .from(schema.stores).where(conds.length ? and(...conds) : undefined);
  const stores = storeRows.map((s) => ({ id: s.id, name: s.name, sellerId: s.sellerId, platform: s.marketplace as string | null }));

  const sellerIds = Array.from(new Set(stores.map((s) => s.sellerId).filter(Boolean))) as string[];
  const sellers = sellerIds.length
    ? (await db.select({ id: schema.users.id, name: schema.users.fullName }).from(schema.users).where(inArray(schema.users.id, sellerIds)))
        .map((u) => ({ id: u.id, name: u.name }))
    : [];

  return <ProductSalesClient
    stores={JSON.parse(JSON.stringify(stores))}
    sellers={JSON.parse(JSON.stringify(sellers))}
    canPickSeller={isAdmin || sellers.length > 1}
  />;
}
