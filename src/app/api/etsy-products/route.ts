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

// GET /api/etsy-products — list Etsy listings in scope (with store name)
// GET /api/etsy-products?id=<uuid> — full detail of ONE listing (for the Edit drawer)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const storeIds = await scopedEtsyStoreIds(session);
  if (!storeIds.length) return NextResponse.json({ ok: true, rows: [] });

  const id = req.nextUrl.searchParams.get("id");
  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    const [row] = await db.select({
      p: schema.etsyProducts, storeName: schema.stores.name, sellerName: schema.users.fullName,
    }).from(schema.etsyProducts)
      .leftJoin(schema.stores, eq(schema.stores.id, schema.etsyProducts.storeId))
      .leftJoin(schema.users, eq(schema.users.id, schema.stores.sellerId))
      .where(sql`${schema.etsyProducts.id} = ${id}::uuid AND ${schema.etsyProducts.storeId} IN (${sql.join(storeIds.map((x) => sql`${x}::uuid`), sql`, `)})`).limit(1);
    if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, item: JSON.parse(JSON.stringify({ ...row.p, storeName: row.storeName, sellerName: row.sellerName })) });
  }

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
    sellerId: schema.stores.sellerId,
    sellerName: schema.users.fullName,
  }).from(schema.etsyProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.etsyProducts.storeId))
    .leftJoin(schema.users, eq(schema.users.id, schema.stores.sellerId))
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

// PATCH /api/etsy-products { id, title?, price?, tags?, description? } — sửa tay 1 listing.
// title/tags/description ghi vào cột shopify_* (bản dùng khi Export Shopify), KHÔNG đè bản gốc Etsy.
// price ghi thẳng vào price (giá dùng cho export). Chỉ sửa được listing thuộc store trong scope.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const storeIds = await scopedEtsyStoreIds(session);
  if (!storeIds.length) return NextResponse.json({ ok: false, error: "no stores in scope" }, { status: 403 });

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof b.title === "string") patch.shopifyTitle = b.title.trim().slice(0, 140) || null;
  if (typeof b.tags === "string") patch.shopifyTags = b.tags.trim().slice(0, 600) || null;
  if (typeof b.description === "string") patch.shopifyDesc = b.description.trim().slice(0, 4000) || null;
  if (b.price !== undefined && b.price !== "") {
    const p = Number(b.price);
    if (Number.isFinite(p) && p >= 0) patch.price = p.toFixed(2);
  }
  const upd = await db.update(schema.etsyProducts).set(patch)
    .where(sql`${schema.etsyProducts.id} = ${id}::uuid AND ${schema.etsyProducts.storeId} IN (${sql.join(storeIds.map((x) => sql`${x}::uuid`), sql`, `)})`)
    .returning({ id: schema.etsyProducts.id });
  if (!upd.length) return NextResponse.json({ ok: false, error: "not found or not in your scope" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// POST /api/etsy-products { action:"duplicate", id } — nhân bản 1 listing (title + " (Copy)").
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "");
  if (b?.action !== "duplicate" || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  const storeIds = await scopedEtsyStoreIds(session);
  const [src] = await db.select().from(schema.etsyProducts)
    .where(sql`${schema.etsyProducts.id} = ${id}::uuid AND ${schema.etsyProducts.storeId} IN (${sql.join(storeIds.map((x) => sql`${x}::uuid`), sql`, `)})`).limit(1);
  if (!src) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const { id: _omit, importedAt: _i, updatedAt: _u, ...rest } = src as Record<string, unknown>;
  void _omit; void _i; void _u;
  await db.insert(schema.etsyProducts).values({ ...(rest as typeof schema.etsyProducts.$inferInsert), title: `${src.title} (Copy)` });
  return NextResponse.json({ ok: true });
}

// DELETE /api/etsy-products { ids: string[] } — bulk delete (only listings in your store scope)
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
