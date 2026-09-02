import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { desc, inArray, sql, and, eq } from "drizzle-orm";
import { storeOwnerScopeIds } from "@/lib/scope";
import TiktokProductsClient from "./products-client";

export const dynamic = "force-dynamic";

export default async function TiktokProductsPage() {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) {
    return <div className="panel empty">You don&apos;t have permission to view Products.</div>;
  }

  const scopeIds = await storeOwnerScopeIds(session);
  // CHỈ store TikTok (bỏ Etsy/khác) + trong phạm vi seller.
  const storeConds = [eq(schema.stores.marketplace, "tiktok")];
  if (scopeIds) storeConds.push(inArray(schema.stores.sellerId, scopeIds));
  const stores = await db.select({ id: schema.stores.id, name: schema.stores.name, sellerId: schema.stores.sellerId })
    .from(schema.stores).where(and(...storeConds));

  const productWhere = scopeIds ? (stores.length ? inArray(schema.tiktokProducts.storeId, stores.map((s) => s.id)) : sql`false`) : undefined;
  // CHỈ lấy cột hiển thị — KHÔNG kéo cột `raw` (jsonb rất nặng) để giảm payload/độ trễ trang.
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
    .where(productWhere)
    .orderBy(desc(schema.tiktokProducts.ttUpdateTime)).limit(1000);

  // Số ĐƠN theo listing: khớp phần SỐ của tiktok_product_id ↔ order_items.etsy_listing_id
  // (import TikTok ghi etsy_listing_id = product_id). Loại đơn new/cancel/trash.
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
  } catch { /* bảng trống / lỗi → để 0 */ }
  const rowsWithOrders = rows.map((r) => {
    const d = String(r.tiktokProductId ?? "").replace(/\D/g, "");
    return { ...r, orders: d ? (orderCountByPid.get(d) ?? 0) : 0 };
  });

  // Danh sách seller cho filter (theo store TikTok trong phạm vi).
  const sellerIds = Array.from(new Set(stores.map((s) => s.sellerId).filter(Boolean))) as string[];
  const sellers = sellerIds.length
    ? await db.select({ id: schema.users.id, name: schema.users.fullName }).from(schema.users).where(inArray(schema.users.id, sellerIds))
    : [];

  const isAdmin = session.role === "admin";
  const canManage = (await levelOf(session, "products")) >= 2; // Clone / Edit cần quyền full
  return <TiktokProductsClient
    stores={JSON.parse(JSON.stringify(stores))}
    sellers={JSON.parse(JSON.stringify(sellers))}
    initial={JSON.parse(JSON.stringify(rowsWithOrders))}
    isAdmin={isAdmin}
    canManage={canManage}
  />;
}
