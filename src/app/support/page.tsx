import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { storeOwnerScopeIds } from "@/lib/scope";
import { readTtCfg } from "@/lib/tiktok-shop";
import SupportClient from "./support-client";

export const dynamic = "force-dynamic";

// Support inbox — customer messages TikTok. Seller chỉ thấy store MÌNH; admin thấy hết.
export default async function SupportPage() {
  const session = await getSession();
  if (!session || (await levelOf(session, "support")) < 1) {
    return <div className="panel empty">You don&apos;t have permission to view Support.</div>;
  }

  const scopeIds = await storeOwnerScopeIds(session);
  const conds = [eq(schema.stores.marketplace, "tiktok")];
  if (scopeIds) conds.push(inArray(schema.stores.sellerId, scopeIds));
  const rows = await db.select({ id: schema.stores.id, name: schema.stores.name, sellerId: schema.stores.sellerId, c: schema.stores.apiCredentials })
    .from(schema.stores).where(and(...conds));

  // Chỉ store đã kết nối TikTok (có refresh token).
  const stores = rows
    .filter((s) => readTtCfg((s.c ?? null) as Record<string, string> | null).refreshToken)
    .map((s) => ({ id: s.id, name: s.name, sellerId: s.sellerId }));

  const sellerIds = Array.from(new Set(stores.map((s) => s.sellerId).filter(Boolean))) as string[];
  const sellers = sellerIds.length
    ? await db.select({ id: schema.users.id, name: schema.users.fullName }).from(schema.users).where(inArray(schema.users.id, sellerIds))
    : [];

  return <SupportClient stores={JSON.parse(JSON.stringify(stores))} sellers={JSON.parse(JSON.stringify(sellers))} />;
}
