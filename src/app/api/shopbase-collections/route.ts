import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopbaseApi, shopbaseConfigured, type ShopBaseCred } from "@/lib/shopbase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * v405 · SHOPBASE COLLECTIONS — quản lý collection ngay trong FUSION (REST clone Shopify legacy):
 *   GET  ?store=<uuid>                    → danh sách collection (custom + smart) của store
 *   GET  ?store=<uuid>&collection=<id>    → sản phẩm trong collection (collects + map với bản sync local)
 *   POST { storeId, action: "create", title }
 *   POST { storeId, action: "delete", collectionId }
 *   POST { storeId, action: "add"|"remove", collectionId, collectionTitle, productIds: string[] }
 *        productIds = id SỐ ShopBase. add = POST collects.json từng sản phẩm; remove = tra collect id rồi DELETE.
 * Smart collection (tự gom theo rule) không add/remove tay được — UI chỉ cho thao tác với custom.
 * Sau add/remove: cập nhật luôn jsonb collections của bản ghi local để Manage Products hiển thị đúng.
 */
const strv = (v: unknown) => (v == null ? "" : String(v)).trim();

async function loadStore(storeId: string, session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store || store.marketplace !== "shopbase") return { error: "not a ShopBase store" };
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!store.sellerId || !scopeIds.includes(store.sellerId))) return { error: "forbidden" };
  const cred = ((store.apiCredentials ?? {}) as Record<string, unknown>).shopbase as ShopBaseCred | undefined;
  if (!shopbaseConfigured(cred ?? null)) return { error: "ShopBase store is not configured — add Subdomain + API key + Password in Stores first" };
  return { store, cred: cred! };
}

type Col = { id: string; title: string; handle: string; published: boolean; kind: "custom" | "smart" };
function normCol(c: Record<string, unknown>, kind: "custom" | "smart"): Col {
  return { id: strv(c.id), title: strv(c.title), handle: strv(c.handle), published: !!strv(c.published_at), kind };
}

// Kéo toàn bộ collects của 1 collection (paginate since_id, trần trang chống chạy vô tận).
async function fetchCollects(cred: ShopBaseCred, collectionId: string): Promise<{ collectId: string; productId: string }[]> {
  const out: { collectId: string; productId: string }[] = [];
  let sinceId = "0";
  for (let i = 0; i < 8; i++) {
    const j = await shopbaseApi(cred, `collects.json?collection_id=${collectionId}&limit=250&since_id=${sinceId}`);
    const batch = (Array.isArray(j.collects) ? j.collects : []) as Record<string, unknown>[];
    if (!batch.length) break;
    for (const c of batch) out.push({ collectId: strv(c.id), productId: strv(c.product_id) });
    const last = strv(batch[batch.length - 1]?.id);
    if (!last || last === sinceId) break;
    sinceId = last;
    if (batch.length < 250) break;
  }
  return out;
}

// Cập nhật jsonb collections của bản ghi local (add/remove) — sai lệch không chặn response.
async function patchLocalCollections(storeId: string, productIds: string[], col: { id: string; title: string }, mode: "add" | "remove") {
  try {
    const rows = await db.select({ id: schema.shopbaseProducts.id, pid: schema.shopbaseProducts.shopbaseProductId, collections: schema.shopbaseProducts.collections })
      .from(schema.shopbaseProducts)
      .where(and(eq(schema.shopbaseProducts.storeId, storeId), inArray(schema.shopbaseProducts.shopbaseProductId, productIds)));
    for (const r of rows) {
      const cur = (Array.isArray(r.collections) ? r.collections : []) as { id?: string; title?: string }[];
      let next = cur.filter((c) => strv(c?.id) !== col.id);
      if (mode === "add") next = [...next, { id: col.id, title: col.title }];
      await db.update(schema.shopbaseProducts).set({ collections: next, updatedAt: new Date() }).where(eq(schema.shopbaseProducts.id, r.id));
    }
  } catch { /* hiển thị sẽ đúng lại sau lần Sync kế */ }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const storeId = String(req.nextUrl.searchParams.get("store") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return NextResponse.json({ ok: false, error: "store required" }, { status: 400 });
  const ctx = await loadStore(storeId, session);
  if ("error" in ctx) return NextResponse.json({ ok: false, error: ctx.error }, { status: 400 });

  const collectionId = strv(req.nextUrl.searchParams.get("collection"));

  // ── Chi tiết: sản phẩm trong 1 collection ──────────────────────────────
  if (collectionId) {
    try {
      const collects = await fetchCollects(ctx.cred, collectionId);
      const pids = collects.map((c) => c.productId).filter(Boolean);
      const locals = pids.length
        ? await db.select({
            id: schema.shopbaseProducts.id, pid: schema.shopbaseProducts.shopbaseProductId,
            title: schema.shopbaseProducts.title, status: schema.shopbaseProducts.status,
            images: schema.shopbaseProducts.images, onlineStoreUrl: schema.shopbaseProducts.onlineStoreUrl,
          }).from(schema.shopbaseProducts)
            .where(and(eq(schema.shopbaseProducts.storeId, storeId), inArray(schema.shopbaseProducts.shopbaseProductId, pids)))
        : [];
      const byPid = new Map(locals.map((l) => [l.pid, l]));
      const products = collects.map((c) => {
        const l = byPid.get(c.productId);
        const imgs = (Array.isArray(l?.images) ? l!.images : []) as { src?: string; position?: number }[];
        const thumb = imgs.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99)).map((i) => strv(i?.src)).find((s) => /^https?:\/\//i.test(s)) ?? null;
        return {
          productId: c.productId, collectId: c.collectId,
          localId: l?.id ?? null, title: l?.title ?? `#${c.productId}`,
          status: l?.status ?? "—", thumb, onlineStoreUrl: l?.onlineStoreUrl ?? null,
        };
      });
      return NextResponse.json({ ok: true, products });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 250) });
    }
  }

  // ── Danh sách collection (custom + smart) ──────────────────────────────
  const collections: Col[] = [];
  try {
    const j = await shopbaseApi(ctx.cred, "custom_collections.json?limit=250");
    for (const c of (Array.isArray(j.custom_collections) ? j.custom_collections : []) as Record<string, unknown>[]) collections.push(normCol(c, "custom"));
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 250) });
  }
  try {
    const j = await shopbaseApi(ctx.cred, "smart_collections.json?limit=250");
    for (const c of (Array.isArray(j.smart_collections) ? j.smart_collections : []) as Record<string, unknown>[]) collections.push(normCol(c, "smart"));
  } catch { /* store không có smart collections / endpoint không hỗ trợ → bỏ qua */ }
  collections.sort((a, b) => a.title.localeCompare(b.title));
  return NextResponse.json({ ok: true, collections });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const storeId = String(b?.storeId ?? "").trim();
  const action = String(b?.action ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return NextResponse.json({ ok: false, error: "storeId required" }, { status: 400 });
  const ctx = await loadStore(storeId, session);
  if ("error" in ctx) return NextResponse.json({ ok: false, error: ctx.error }, { status: 400 });

  try {
    if (action === "create") {
      const title = strv(b?.title).slice(0, 200);
      if (!title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
      const j = await shopbaseApi(ctx.cred, "custom_collections.json", { method: "POST", body: JSON.stringify({ custom_collection: { title } }) });
      const c = (j.custom_collection ?? {}) as Record<string, unknown>;
      return NextResponse.json({ ok: true, collection: normCol(c, "custom") });
    }

    const collectionId = strv(b?.collectionId);
    if (!collectionId) return NextResponse.json({ ok: false, error: "collectionId required" }, { status: 400 });

    if (action === "delete") {
      await shopbaseApi(ctx.cred, `custom_collections/${collectionId}.json`, { method: "DELETE" });
      // Gỡ collection khỏi jsonb local của mọi sản phẩm đang mang nó.
      try {
        const rows = await db.select({ id: schema.shopbaseProducts.id, collections: schema.shopbaseProducts.collections })
          .from(schema.shopbaseProducts).where(eq(schema.shopbaseProducts.storeId, storeId));
        for (const r of rows) {
          const cur = (Array.isArray(r.collections) ? r.collections : []) as { id?: string }[];
          if (!cur.some((c) => strv(c?.id) === collectionId)) continue;
          await db.update(schema.shopbaseProducts).set({ collections: cur.filter((c) => strv(c?.id) !== collectionId), updatedAt: new Date() }).where(eq(schema.shopbaseProducts.id, r.id));
        }
      } catch { /* Sync kế sẽ chỉnh lại */ }
      return NextResponse.json({ ok: true });
    }

    if (action === "add" || action === "remove") {
      const productIds = (Array.isArray(b?.productIds) ? b.productIds : []).map(strv).filter(Boolean).slice(0, 250) as string[];
      if (!productIds.length) return NextResponse.json({ ok: false, error: "productIds required" }, { status: 400 });
      const collectionTitle = strv(b?.collectionTitle).slice(0, 200);
      let done = 0;
      const failed: { productId: string; error: string }[] = [];

      if (action === "add") {
        for (const pid of productIds) {
          try {
            await shopbaseApi(ctx.cred, "collects.json", { method: "POST", body: JSON.stringify({ collect: { product_id: Number(pid) || pid, collection_id: Number(collectionId) || collectionId } }) });
            done++;
          } catch (e) {
            const msg = String((e as Error)?.message ?? e);
            if (/already|exists|taken/i.test(msg)) done++;   // đã ở trong collection sẵn = coi như xong
            else failed.push({ productId: pid, error: msg.slice(0, 160) });
          }
        }
      } else {
        const collects = await fetchCollects(ctx.cred, collectionId);
        const collectByPid = new Map(collects.map((c) => [c.productId, c.collectId]));
        for (const pid of productIds) {
          const cid = collectByPid.get(pid);
          if (!cid) { done++; continue; }   // không còn trong collection = coi như xong
          try { await shopbaseApi(ctx.cred, `collects/${cid}.json`, { method: "DELETE" }); done++; }
          catch (e) { failed.push({ productId: pid, error: String((e as Error)?.message ?? e).slice(0, 160) }); }
        }
      }

      const okPids = productIds.filter((p) => !failed.some((f) => f.productId === p));
      if (okPids.length) await patchLocalCollections(storeId, okPids, { id: collectionId, title: collectionTitle }, action);
      return NextResponse.json({ ok: failed.length === 0, done, failed });
    }

    return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 250) });
  }
}
