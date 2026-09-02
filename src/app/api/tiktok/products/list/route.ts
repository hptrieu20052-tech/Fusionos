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

  // CHỈ cột hiển thị — KHÔNG kéo `raw` (jsonb nặng) để nhẹ payload.
  const rows = await db.select({
    id: schema.tiktokProducts.id,
    storeId: schema.tiktokProducts.storeId,
    tiktokProductId: schema.tiktokProducts.tiktokProductId,
    title: schema.tiktokProducts.title,
    status: schema.tiktokProducts.status,
    mainImageUrl: schema.tiktokProducts.mainImageUrl,
    categoryName: schema.tiktokProducts.categoryName,
    sellerSku: schema.tiktokProducts.sellerSku,
    priceMin: schema.tiktokProducts.priceMin,
    ttUpdateTime: schema.tiktokProducts.ttUpdateTime,
  }).from(schema.tiktokProducts)
    .where(storeFilter)
    .orderBy(desc(schema.tiktokProducts.ttUpdateTime)).limit(1000);

  // Số ĐƠN theo listing: khớp phần SỐ của tiktok_product_id ↔ order_items.etsy_listing_id.
  const orderCountByPid = new Map<string, number>();
  try {
    const oc = (await db.execute(sql`
      SELECT regexp_replace(coalesce(oi.etsy_listing_id, ''), '[^0-9]', '', 'g') AS pid,
             count(DISTINCT oi.order_id)::int AS n
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status NOT IN ('new','cancel','trash')
      GROUP BY 1
    `)).rows as { pid: string; n: number }[];
    for (const r of oc) if (r.pid) orderCountByPid.set(r.pid, Number(r.n));
  } catch { /* để 0 */ }
  const rowsWithOrders = rows.map((r) => {
    const d = String(r.tiktokProductId ?? "").replace(/\D/g, "");
    return { ...r, orders: d ? (orderCountByPid.get(d) ?? 0) : 0 };
  });
  return NextResponse.json({ ok: true, rows: JSON.parse(JSON.stringify(rowsWithOrders)) });
}
