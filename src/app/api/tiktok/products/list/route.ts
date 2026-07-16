import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // Phạm vi: seller chỉ thấy product của store MÌNH (store.sellerId ∈ scope). admin/all → không giới hạn.
  const scopeIds = await storeOwnerScopeIds(session);
  let storeFilter;
  if (scopeIds) {
    const myStores = await db.select({ id: schema.stores.id }).from(schema.stores).where(inArray(schema.stores.sellerId, scopeIds));
    const ids = myStores.map((s) => s.id);
    storeFilter = ids.length ? inArray(schema.tiktokProducts.storeId, ids) : sql`false`;
  }

  const rows = await db.select().from(schema.tiktokProducts)
    .where(storeFilter)
    .orderBy(desc(schema.tiktokProducts.ttUpdateTime)).limit(1000);
  return NextResponse.json({ ok: true, rows: JSON.parse(JSON.stringify(rows)) });
}
