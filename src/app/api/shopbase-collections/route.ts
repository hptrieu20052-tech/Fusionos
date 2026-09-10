import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, asc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { storefrontUrl } from "@/lib/shopbase";

export const dynamic = "force-dynamic";

/**
 * v417 · SHOPBASE COLLECTIONS — CHẠY BẰNG TAG.
 *
 * ShopBase KHÔNG mở API collection cho private app (custom_collections 404, collections 401,
 * không có scope listing nào để bật). Giải pháp: mỗi "collection" = 1 TAG.
 *   - FUSION lưu danh sách collection-tag (bảng shopbase_collection_tags).
 *   - Trên ShopBase, seller tạo SMART collection điều kiện "Product tag is equal to <tag>" (1 lần).
 *   - Gắn/gỡ sản phẩm = add/remove tag qua /api/shopbase-products/action (write_products đang chạy tốt).
 *
 *   GET  ?store=<uuid>            → danh sách collection-tag + số sản phẩm local mang tag
 *                                    (shape {collections:[{id,title,tag,kind,count}]} — template picker dùng chung)
 *   GET  ?store=<uuid>&tag=<tag>  → sản phẩm local đang mang tag đó
 *   POST { storeId, action: "create", title, tag? }   → thêm collection-tag
 *   POST { storeId, action: "delete", id }            → xoá collection-tag (chỉ xoá định nghĩa trong
 *                                    FUSION — tag trên sản phẩm và smart collection bên ShopBase giữ nguyên)
 */
const strv = (v: unknown) => (v == null ? "" : String(v)).trim();
const slugTag = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const tagList = (s: string | null | undefined) => String(s ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);

async function checkStore(storeId: string, session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  const [store] = await db.select({ id: schema.stores.id, sellerId: schema.stores.sellerId, marketplace: schema.stores.marketplace, storeUrl: schema.stores.storeUrl })
    .from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store || store.marketplace !== "shopbase") return { error: "not a ShopBase store" };
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && store.sellerId && !scopeIds.includes(store.sellerId)) return { error: "forbidden" }; // v459: store không chủ → cần được share (bỏ quy tắc store chung)
  return { store };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const storeId = strv(req.nextUrl.searchParams.get("store"));
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return NextResponse.json({ ok: false, error: "store required" }, { status: 400 });
  const ctx = await checkStore(storeId, session);
  if ("error" in ctx) return NextResponse.json({ ok: false, error: ctx.error }, { status: 400 });

  const tagQ = strv(req.nextUrl.searchParams.get("tag")).toLowerCase();

  // Sản phẩm local của store (đã sync/stage) — nguồn đếm + liệt kê theo tag.
  const prods = await db.select({
    id: schema.shopbaseProducts.id, pid: schema.shopbaseProducts.shopbaseProductId,
    title: schema.shopbaseProducts.title, status: schema.shopbaseProducts.status,
    tags: schema.shopbaseProducts.tags, images: schema.shopbaseProducts.images,
    onlineStoreUrl: schema.shopbaseProducts.onlineStoreUrl,
  }).from(schema.shopbaseProducts).where(eq(schema.shopbaseProducts.storeId, storeId));

  // ── Chi tiết: sản phẩm mang tag ────────────────────────────────────────
  if (tagQ) {
    const products = prods.filter((p) => tagList(p.tags).includes(tagQ)).map((p) => {
      const imgs = (Array.isArray(p.images) ? p.images : []) as { src?: string; position?: number }[];
      const thumb = imgs.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99)).map((i) => strv(i?.src)).find((s) => /^https?:\/\//i.test(s)) ?? null;
      return { localId: p.id, productId: p.pid, title: p.title, status: p.status, thumb, onlineStoreUrl: storefrontUrl(p.onlineStoreUrl, ctx.store.storeUrl) };   // v425 · domain bán hàng
    });
    return NextResponse.json({ ok: true, products });
  }

  // ── Danh sách collection-tag ───────────────────────────────────────────
  const rows = await db.select().from(schema.shopbaseCollectionTags)
    .where(eq(schema.shopbaseCollectionTags.storeId, storeId))
    .orderBy(asc(schema.shopbaseCollectionTags.createdAt));
  const countByTag = new Map<string, number>();
  for (const p of prods) for (const t of tagList(p.tags)) countByTag.set(t, (countByTag.get(t) ?? 0) + 1);
  return NextResponse.json({
    ok: true,
    mode: "tags",
    collections: rows.map((r) => ({
      id: r.id, title: r.title, tag: r.tag, kind: "custom" as const,
      count: countByTag.get(r.tag.toLowerCase()) ?? 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const storeId = strv(b?.storeId);
  const action = strv(b?.action);
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return NextResponse.json({ ok: false, error: "storeId required" }, { status: 400 });
  const ctx = await checkStore(storeId, session);
  if ("error" in ctx) return NextResponse.json({ ok: false, error: ctx.error }, { status: 400 });

  if (action === "create") {
    const title = strv(b?.title).slice(0, 120);
    if (!title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
    const tag = slugTag(strv(b?.tag) || "col-" + title);
    if (!tag) return NextResponse.json({ ok: false, error: "tag required" }, { status: 400 });
    const [dup] = await db.select({ id: schema.shopbaseCollectionTags.id }).from(schema.shopbaseCollectionTags)
      .where(and(eq(schema.shopbaseCollectionTags.storeId, storeId), eq(schema.shopbaseCollectionTags.tag, tag))).limit(1);
    if (dup) return NextResponse.json({ ok: false, error: `tag "${tag}" already exists in this store` }, { status: 400 });
    const [row] = await db.insert(schema.shopbaseCollectionTags)
      .values({ storeId, title, tag, createdBy: session.sub }).returning();
    return NextResponse.json({ ok: true, collection: { id: row.id, title: row.title, tag: row.tag, kind: "custom", count: 0 } });
  }

  if (action === "delete") {
    const id = strv(b?.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    await db.delete(schema.shopbaseCollectionTags)
      .where(and(eq(schema.shopbaseCollectionTags.id, id), eq(schema.shopbaseCollectionTags.storeId, storeId)));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
}
