import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopHost, type ShopifyCred } from "@/lib/shopify";
import {
  setProductStatus, deleteProduct, addTags, removeTags,
  publishToPublications, unpublishFromPublications,
  collectionAddProducts, collectionRemoveProducts,
} from "@/lib/shopify-bulk";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Các action per-product (chạy từng sản phẩm) vs per-collection (gom cả list 1 lần).
type Action =
  | "active" | "draft" | "archive" | "delete"
  | "tags_add" | "tags_remove"
  | "channels_include" | "channels_exclude"
  | "catalogs_include" | "catalogs_exclude"
  | "collection_add" | "collection_remove";

const PICKER_ACTIONS: Action[] = ["channels_include", "channels_exclude", "catalogs_include", "catalogs_exclude", "collection_add", "collection_remove"];

const configured = (cred: ShopifyCred, mk: string | null) =>
  mk === "shopify" && !!shopHost(cred) && !!(cred.adminToken || (cred.clientId && cred.clientSecret));

const parseTags = (s: unknown) => String(s ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 100);
const mergeTags = (cur: string | null, add: string[]) => {
  const set = new Set(String(cur ?? "").split(",").map((t) => t.trim()).filter(Boolean));
  add.forEach((t) => set.add(t));
  return Array.from(set).join(", ");
};
const subtractTags = (cur: string | null, rm: string[]) => {
  const low = new Set(rm.map((t) => t.toLowerCase()));
  return String(cur ?? "").split(",").map((t) => t.trim()).filter((t) => t && !low.has(t.toLowerCase())).join(", ");
};

/**
 * POST /api/shopify-products/bulk-action
 *   { ids: string[], action: Action, storeId?, tags?, publicationIds?: string[], collectionId? }
 * Chạy thao tác hàng loạt THẲNG trên Shopify (GraphQL) + đồng bộ lại bản local.
 * PICKER_ACTIONS (channels/catalogs/collections) chỉ áp cho product cùng storeId (id publication/collection theo từng store).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const action = String(b?.action ?? "") as Action;
  const ALL: Action[] = ["active", "draft", "archive", "delete", "tags_add", "tags_remove", ...PICKER_ACTIONS];
  if (!ALL.includes(action)) return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });

  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 100);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });

  const tags = parseTags(b?.tags);
  const publicationIds = (Array.isArray(b?.publicationIds) ? b.publicationIds : []).map(String).filter((s: string) => /^gid:\/\/shopify\//.test(s));
  const collectionId = /^gid:\/\/shopify\/Collection\//.test(String(b?.collectionId ?? "")) ? String(b.collectionId) : "";
  const storeId = /^[0-9a-f-]{36}$/i.test(String(b?.storeId ?? "")) ? String(b.storeId) : "";

  if ((action === "tags_add" || action === "tags_remove") && !tags.length) return NextResponse.json({ ok: false, error: "tags required" }, { status: 400 });
  if ((action === "channels_include" || action === "channels_exclude" || action === "catalogs_include" || action === "catalogs_exclude") && !publicationIds.length)
    return NextResponse.json({ ok: false, error: "publicationIds required" }, { status: 400 });
  if ((action === "collection_add" || action === "collection_remove") && !collectionId) return NextResponse.json({ ok: false, error: "collectionId required" }, { status: 400 });
  if (PICKER_ACTIONS.includes(action) && !storeId) return NextResponse.json({ ok: false, error: "storeId required for this action" }, { status: 400 });

  const rows = await db.select({ p: schema.shopifyProducts, cred: schema.stores.apiCredentials, seller: schema.stores.sellerId, mk: schema.stores.marketplace })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // Picker actions: chỉ giữ product cùng store (publication/collection id gắn với 1 store).
  const targets = PICKER_ACTIONS.includes(action) ? rows.filter((r) => r.p.storeId === storeId) : rows;
  const skipped = rows.length - targets.length;

  const results: { id: string; title: string; ok: boolean; error?: string }[] = [];
  const cache = new Map<string, { cred: ShopifyCred; ok: boolean }>();
  const credOf = (r: typeof rows[number]) => {
    const key = r.p.storeId;
    let c = cache.get(key);
    if (!c) { const cred = (r.cred ?? {}) as ShopifyCred; c = { cred, ok: configured(cred, r.mk) }; cache.set(key, c); }
    return c;
  };

  // ---- Collection add/remove: 1 lần gọi/collection cho cả list gid cùng store ----
  if (action === "collection_add" || action === "collection_remove") {
    const t = targets.filter((r) => credOf(r).ok);
    if (!t.length) return NextResponse.json({ ok: false, error: "no configured Shopify products for this store", skipped }, { status: 400 });
    const cred = credOf(t[0]).cred;
    const gids = t.map((r) => r.p.shopifyProductId);
    try {
      if (action === "collection_add") await collectionAddProducts(cred, collectionId, gids);
      else await collectionRemoveProducts(cred, collectionId, gids);
      t.forEach((r) => results.push({ id: r.p.id, title: r.p.title, ok: true }));
    } catch (e) {
      const err = String((e as Error)?.message ?? e).slice(0, 200);
      t.forEach((r) => results.push({ id: r.p.id, title: r.p.title, ok: false, error: err }));
    }
    const done = results.filter((r) => r.ok).length;
    return NextResponse.json({ ok: done > 0, done, failed: results.length - done, skipped, results });
  }

  // ---- Per-product actions ----
  for (const r of targets) {
    const c = credOf(r);
    if (!c.ok) { results.push({ id: r.p.id, title: r.p.title, ok: false, error: "store chưa cấu hình Shopify API" }); continue; }
    const gid = r.p.shopifyProductId;
    try {
      switch (action) {
        case "active": await setProductStatus(c.cred, gid, "ACTIVE"); await db.update(schema.shopifyProducts).set({ status: "ACTIVE", updatedAt: new Date() }).where(eq(schema.shopifyProducts.id, r.p.id)); break;
        case "draft": await setProductStatus(c.cred, gid, "DRAFT"); await db.update(schema.shopifyProducts).set({ status: "DRAFT", updatedAt: new Date() }).where(eq(schema.shopifyProducts.id, r.p.id)); break;
        case "archive": await setProductStatus(c.cred, gid, "ARCHIVED"); await db.update(schema.shopifyProducts).set({ status: "ARCHIVED", updatedAt: new Date() }).where(eq(schema.shopifyProducts.id, r.p.id)); break;
        case "delete": await deleteProduct(c.cred, gid); await db.delete(schema.shopifyProducts).where(eq(schema.shopifyProducts.id, r.p.id)); break;
        case "tags_add": await addTags(c.cred, gid, tags); await db.update(schema.shopifyProducts).set({ tags: mergeTags(r.p.tags, tags), updatedAt: new Date() }).where(eq(schema.shopifyProducts.id, r.p.id)); break;
        case "tags_remove": await removeTags(c.cred, gid, tags); await db.update(schema.shopifyProducts).set({ tags: subtractTags(r.p.tags, tags), updatedAt: new Date() }).where(eq(schema.shopifyProducts.id, r.p.id)); break;
        case "channels_include": case "catalogs_include": await publishToPublications(c.cred, gid, publicationIds); break;
        case "channels_exclude": case "catalogs_exclude": await unpublishFromPublications(c.cred, gid, publicationIds); break;
      }
      results.push({ id: r.p.id, title: r.p.title, ok: true });
    } catch (e) {
      results.push({ id: r.p.id, title: r.p.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }

  const done = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: done > 0, done, failed: results.length - done, skipped, results });
}
