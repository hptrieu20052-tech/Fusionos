import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

// Danh sách store ETSY trong phạm vi của user (seller chỉ thấy store mình — giống Manage Tiktok)
async function scopedEtsyStoreIds(session: NonNullable<Awaited<ReturnType<typeof getSession>>>): Promise<string[]> {
  const scopeIds = await storeOwnerScopeIds(session);
  const conds = [eq(schema.stores.marketplace, "etsy")];
  if (scopeIds) conds.push(inArray(schema.stores.sellerId, scopeIds));
  const rows = await db.select({ id: schema.stores.id }).from(schema.stores)
    .where(conds.length > 1 ? sql`${conds[0]} AND ${conds[1]}` : conds[0]);
  return rows.map((r) => r.id);
}

// GET /api/etsy-products — listing Etsy trong phạm vi (kèm tên store)
export async function GET() {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const storeIds = await scopedEtsyStoreIds(session);
  if (!storeIds.length) return NextResponse.json({ ok: true, rows: [] });

  const rows = await db.select({
    id: schema.etsyProducts.id,
    storeId: schema.etsyProducts.storeId,
    title: schema.etsyProducts.title,
    price: schema.etsyProducts.price,
    quantity: schema.etsyProducts.quantity,
    tags: schema.etsyProducts.tags,
    images: schema.etsyProducts.images,
    variations: schema.etsyProducts.variations,
    sku: schema.etsyProducts.sku,
    status: schema.etsyProducts.status,
    shopifyTitle: schema.etsyProducts.shopifyTitle,
    importedAt: schema.etsyProducts.importedAt,
    storeName: schema.stores.name,
  }).from(schema.etsyProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.etsyProducts.storeId))
    .where(inArray(schema.etsyProducts.storeId, storeIds))
    .orderBy(desc(schema.etsyProducts.importedAt)).limit(2000);

  // Chỉ giữ ảnh đầu cho list (payload nhẹ); variations rút gọn thành chuỗi tóm tắt
  const out = rows.map((r) => ({
    ...r,
    images: undefined,
    mainImageUrl: Array.isArray(r.images) && r.images.length ? String((r.images as string[])[0]) : null,
    variationsSummary: Array.isArray(r.variations)
      ? (r.variations as { name?: string; values?: string[] }[]).map((v) => `${v.name}: ${(v.values ?? []).length}`).join(" · ")
      : "",
    variations: undefined,
  }));
  return NextResponse.json({ ok: true, rows: JSON.parse(JSON.stringify(out)) });
}

// DELETE /api/etsy-products { ids: string[] } — xoá hàng loạt (chỉ trong phạm vi store của mình)
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 500);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  const storeIds = await scopedEtsyStoreIds(session);
  if (!storeIds.length) return NextResponse.json({ ok: false, error: "no stores in scope" }, { status: 403 });
  const del = await db.delete(schema.etsyProducts)
    .where(sql`${schema.etsyProducts.id} IN (${sql.join(ids.map((x: string) => sql`${x}::uuid`), sql`, `)}) AND ${schema.etsyProducts.storeId} IN (${sql.join(storeIds.map((x) => sql`${x}::uuid`), sql`, `)})`)
    .returning({ id: schema.etsyProducts.id });
  return NextResponse.json({ ok: true, deleted: del.length });
}
