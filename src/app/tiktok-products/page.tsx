import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { desc } from "drizzle-orm";
import TiktokProductsClient from "./products-client";

export const dynamic = "force-dynamic";

export default async function TiktokProductsPage() {
  const session = await getSession();
  if (!session || (await levelOf(session, "orders")) < 1) {
    return <div className="panel empty">You don&apos;t have permission to view Products.</div>;
  }
  const stores = await db.select({ id: schema.stores.id, name: schema.stores.name }).from(schema.stores);
  const rows = await db.select().from(schema.tiktokProducts).orderBy(desc(schema.tiktokProducts.ttUpdateTime)).limit(1000);
  const isAdmin = session.role === "admin";
  return <TiktokProductsClient stores={stores} initial={JSON.parse(JSON.stringify(rows))} isAdmin={isAdmin} />;
}
