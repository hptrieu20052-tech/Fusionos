import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { payloadOf } from "@/lib/personalization";

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
    personalization: schema.etsyProducts.personalization,
    shopifyProductId: schema.etsyProducts.shopifyProductId,
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
    // v142: số ô cá nhân hoá của listing — để hiện chip trong bảng, khỏi mở từng cái ra xem.
    persCount: Array.isArray(r.personalization) ? r.personalization.length : 0,
    personalization: undefined,
    pushed: !!r.shopifyProductId, // đã push qua Shopify chưa
    mainImageUrl: Array.isArray(r.images) && r.images.length ? String((r.images as string[])[0]) : null,
    variationsSummary: Array.isArray(r.variations)
      ? (r.variations as { name?: string; values?: string[] }[]).map((v) => `${v.name}: ${(v.values ?? []).length}`).join(" · ")
      : "",
    variations: undefined,
  }));
  return NextResponse.json({ ok: true, rows: JSON.parse(JSON.stringify(out)) });
}

// PATCH /api/etsy-products { id, title?, price?, tags?, description?, images?, variations? } — sửa tay 1 listing.
// title/tags/description ghi vào cột shopify_* (bản dùng khi Export Shopify), KHÔNG đè bản gốc Etsy.
// price/images/variations ghi thẳng (dùng cho export). Chỉ sửa listing thuộc store trong scope.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const storeIds = await scopedEtsyStoreIds(session);
  if (!storeIds.length) return NextResponse.json({ ok: false, error: "no stores in scope" }, { status: 403 });

  try {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof b.title === "string") patch.shopifyTitle = b.title.trim().slice(0, 200) || null;
    if (typeof b.tags === "string") patch.shopifyTags = b.tags.trim().slice(0, 600) || null;
    if (typeof b.description === "string") patch.shopifyDesc = b.description.trim().slice(0, 4000) || null;
    if (b.price !== undefined && b.price !== "") {
      const p = Number(b.price);
      if (Number.isFinite(p) && p >= 0) patch.price = p.toFixed(2);
    }
    // Xoá/sắp lại ảnh: nhận mảng URL đã lọc (tối đa 20, chỉ http/https).
    if (Array.isArray(b.images)) {
      patch.images = b.images.map((x: unknown) => String(x)).filter((u: string) => /^https?:\/\//i.test(u)).slice(0, 20);
    }
    // Sửa biến thể: [{name, values:[]}] — bỏ variation rỗng.
    if (Array.isArray(b.variations)) {
      patch.variations = b.variations
        .map((v: { name?: unknown; values?: unknown }) => ({
          name: String(v?.name ?? "").trim().slice(0, 60),
          values: (Array.isArray(v?.values) ? v.values : []).map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 40),
        }))
        .filter((v: { name: string; values: string[] }) => v.name && v.values.length)
        .slice(0, 6);
    }
    // v142 · Custom options. Gửi mảng = ghi đè; gửi null = xoá hẳn (listing không có ô nào).
    // Không gửi field này ⇒ giữ nguyên, để Save bên tab khác không xoá nhầm.
    if (Array.isArray(b.personalization)) patch.personalization = payloadOf(b.personalization);
    else if (b.personalization === null) patch.personalization = null;
    const upd = await db.update(schema.etsyProducts).set(patch)
      .where(sql`${schema.etsyProducts.id} = ${id}::uuid AND ${schema.etsyProducts.storeId} IN (${sql.join(storeIds.map((x) => sql`${x}::uuid`), sql`, `)})`)
      .returning({ id: schema.etsyProducts.id });
    if (!upd.length) return NextResponse.json({ ok: false, error: "not found or not in your scope" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    const hint = /shopify_|column|does not exist/i.test(m) ? " — Run MIGRATION_etsy_products.sql (adds shopify_title/tags/desc) in Supabase first." : "";
    return NextResponse.json({ ok: false, error: "server: " + m.slice(0, 200) + hint }, { status: 500 });
  }
}

// POST /api/etsy-products { action:"duplicate", id } — nhân bản 1 listing (title + " (Copy)").
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);

  // ----- CREATE MANUAL -----
  // Ý tưởng mới chưa có trên Etsy vẫn cần một dòng ở đây, vì Push Shopify và AI Optimize đều đọc
  // từ bảng này. shopify_product_id để trống ⇒ Push lần đầu TẠO MỚI trên Shopify, không đè cái nào.
  if (b?.action === "create") {
    const storeId = String(b?.storeId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(storeId)) return NextResponse.json({ ok: false, error: "storeId required" }, { status: 400 });
    const scoped = await scopedEtsyStoreIds(session);
    if (!scoped.includes(storeId)) return NextResponse.json({ ok: false, error: "store not in your scope" }, { status: 403 });
    const title = String(b?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });

    // Import CSV dedupe theo (store, title) vì CSV Etsy không có listing id ⇒ trùng title là hỏng.
    const [dup] = await db.select({ id: schema.etsyProducts.id }).from(schema.etsyProducts)
      .where(sql`${schema.etsyProducts.storeId} = ${storeId}::uuid AND lower(${schema.etsyProducts.title}) = lower(${title})`).limit(1);
    if (dup) return NextResponse.json({ ok: false, error: "a listing with this exact title already exists in this store" }, { status: 409 });

    const priceNum = Number(b?.price);
    const qtyNum = Number(b?.quantity);
    const images = (Array.isArray(b?.images) ? b.images : []).map((x: unknown) => String(x)).filter((u: string) => /^https?:\/\//i.test(u)).slice(0, 20);
    const variations = (Array.isArray(b?.variations) ? b.variations : [])
      .map((v: { name?: unknown; values?: unknown }) => ({
        name: String(v?.name ?? "").trim().slice(0, 60),
        values: (Array.isArray(v?.values) ? v.values : []).map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 40),
      }))
      .filter((v: { name: string; values: string[] }) => v.name && v.values.length)
      .slice(0, 6);

    try {
      const [ins] = await db.insert(schema.etsyProducts).values({
        storeId, title,
        description: String(b?.description ?? "").trim().slice(0, 8000) || null,
        price: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum.toFixed(2) : null,
        quantity: Number.isFinite(qtyNum) && qtyNum >= 0 ? Math.floor(qtyNum) : null,
        tags: String(b?.tags ?? "").trim().slice(0, 600) || null,
        sku: String(b?.sku ?? "").trim().slice(0, 100) || null,
        images, variations, status: "active",
        personalization: Array.isArray(b?.personalization) ? payloadOf(b.personalization) : null,
      }).returning({ id: schema.etsyProducts.id });
      return NextResponse.json({ ok: true, id: ins?.id });
    } catch (e) {
      return NextResponse.json({ ok: false, error: "server: " + String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
    }
  }

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
