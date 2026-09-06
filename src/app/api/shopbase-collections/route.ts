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
 * v405b · SHOPBASE COLLECTIONS — quản lý collection ngay trong FUSION.
 *
 * ShopBase clone REST của Shopify nhưng KHÔNG mở đủ path legacy: custom_collections.json có thể
 * trả 404 "no service available" (API gateway không route resource đó). Không có docs công khai
 * cho collection, nên route này TỰ DÒ endpoint: thử lần lượt các path ứng viên, dùng path nào
 * sống; tất cả chết → trả lỗi kèm status từng path (đọc được ngay trên UI để biết store mở gì).
 *
 *   GET  ?store=<uuid>                    → danh sách collection
 *   GET  ?store=<uuid>&collection=<id>    → sản phẩm trong collection
 *   POST { storeId, action: "create", title }
 *   POST { storeId, action: "delete", collectionId }
 *   POST { storeId, action: "add"|"remove", collectionId, collectionTitle, productIds }
 */
const strv = (v: unknown) => (v == null ? "" : String(v)).trim();

async function loadStore(storeId: string, session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store || store.marketplace !== "shopbase") return { error: "not a ShopBase store" };
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && store.sellerId && !scopeIds.includes(store.sellerId)) return { error: "forbidden" }; // sellerId NULL = store chung
  const cred = ((store.apiCredentials ?? {}) as Record<string, unknown>).shopbase as ShopBaseCred | undefined;
  if (!shopbaseConfigured(cred ?? null)) return { error: "ShopBase store is not configured — add Subdomain + API key + Password in Stores first" };
  return { store, cred: cred! };
}

type Col = { id: string; title: string; handle: string; published: boolean; kind: "custom" | "smart" };

// Collection JSON của ShopBase có thể mang cờ smart theo nhiều kiểu — đoán phòng thủ.
function colKind(c: Record<string, unknown>, hint?: "custom" | "smart"): "custom" | "smart" {
  if (hint) return hint;
  if (Array.isArray(c.rules) && c.rules.length) return "smart";
  if (c.is_smart === true || strv(c.collection_type) === "smart") return "smart";
  return "custom";
}
function normCol(c: Record<string, unknown>, hint?: "custom" | "smart"): Col {
  return { id: strv(c.id), title: strv(c.title), handle: strv(c.handle), published: c.published === true || !!strv(c.published_at), kind: colKind(c, hint) };
}

// Thử 1 path — trả data hoặc lỗi gọn (để gom bảng status).
async function tryPath<T>(cred: ShopBaseCred, path: string, pick: (j: Record<string, unknown>) => T | null, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; err: string }> {
  try {
    const j = await shopbaseApi(cred, path, init);
    const data = pick(j);
    if (data == null) return { ok: false, err: "unexpected shape: " + Object.keys(j).slice(0, 5).join(",") };
    return { ok: true, data };
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    const code = /HTTP (\d{3})/.exec(m)?.[1] ?? "ERR";
    return { ok: false, err: code };
  }
}

const arr = (j: Record<string, unknown>, key: string) => (Array.isArray(j[key]) ? (j[key] as Record<string, unknown>[]) : null);

/**
 * Danh sách collection — dò theo thứ tự:
 *   1. custom_collections.json (+ smart_collections.json)  — chuẩn Shopify legacy
 *   2. collections.json                                    — gộp chung, đoán kind theo field
 * Trả kèm "flavor" để create/delete dùng đúng họ path, và probe log khi tất cả chết.
 */
async function listCollections(cred: ShopBaseCred): Promise<{ ok: true; collections: Col[]; flavor: "legacy" | "unified" } | { ok: false; error: string }> {
  const probes: string[] = [];

  const legacy = await tryPath(cred, "custom_collections.json?limit=250", (j) => arr(j, "custom_collections"));
  if (legacy.ok) {
    const out = legacy.data.map((c) => normCol(c, "custom"));
    const smart = await tryPath(cred, "smart_collections.json?limit=250", (j) => arr(j, "smart_collections"));
    if (smart.ok) out.push(...smart.data.map((c) => normCol(c, "smart")));
    out.sort((a, b) => a.title.localeCompare(b.title));
    return { ok: true, collections: out, flavor: "legacy" };
  }
  probes.push(`custom_collections.json → ${legacy.err}`);

  const unified = await tryPath(cred, "collections.json?limit=250", (j) => arr(j, "collections"));
  if (unified.ok) {
    const out = unified.data.map((c) => normCol(c));
    out.sort((a, b) => a.title.localeCompare(b.title));
    return { ok: true, collections: out, flavor: "unified" };
  }
  probes.push(`collections.json → ${unified.err}`);

  // 3. collection_listings.json — họ path của scope "Product Listing / Collection Listing" (read-only).
  const listings = await tryPath(cred, "collection_listings.json?limit=250", (j) => arr(j, "collection_listings"));
  if (listings.ok) {
    const out = listings.data.map((c) => normCol({ ...c, id: c.collection_id ?? c.id }));
    out.sort((a, b) => a.title.localeCompare(b.title));
    return { ok: true, collections: out, flavor: "unified" };
  }
  probes.push(`collection_listings.json → ${listings.err}`);

  const hint = probes.some((x) => x.endsWith("401"))
    ? " — 401 = private app is missing the Collections/Product listing permission. Open the private app in ShopBase → Admin API permissions → grant Read/Write on Collection-related scopes, then Refresh."
    : "";
  return { ok: false, error: "ShopBase collections API not reachable on this store · " + probes.join(" · ") + hint };
}

// Kéo collects của 1 collection (paginate since_id). Path collects.json cũng có thể chết → err.
async function fetchCollects(cred: ShopBaseCred, collectionId: string): Promise<{ ok: true; collects: { collectId: string; productId: string }[] } | { ok: false; err: string }> {
  const out: { collectId: string; productId: string }[] = [];
  let sinceId = "0";
  for (let i = 0; i < 8; i++) {
    const r = await tryPath(cred, `collects.json?collection_id=${collectionId}&limit=250&since_id=${sinceId}`, (j) => arr(j, "collects"));
    if (!r.ok) return i === 0 ? { ok: false, err: r.err } : { ok: true, collects: out };
    const batch = r.data;
    if (!batch.length) break;
    for (const c of batch) out.push({ collectId: strv(c.id), productId: strv(c.product_id) });
    const last = strv(batch[batch.length - 1]?.id);
    if (!last || last === sinceId) break;
    sinceId = last;
    if (batch.length < 250) break;
  }
  return { ok: true, collects: out };
}

// Fallback đọc sản phẩm trong collection khi collects.json chết: products.json?collection_id=
async function fetchCollectionProductIds(cred: ShopBaseCred, collectionId: string): Promise<{ ok: true; productIds: string[] } | { ok: false; err: string }> {
  const out: string[] = [];
  let sinceId = "0";
  for (let i = 0; i < 8; i++) {
    const r = await tryPath(cred, `products.json?collection_id=${collectionId}&limit=250&since_id=${sinceId}`, (j) => arr(j, "products"));
    if (!r.ok) return i === 0 ? { ok: false, err: r.err } : { ok: true, productIds: out };
    const batch = r.data;
    if (!batch.length) break;
    for (const p of batch) { const id = strv(p.id); if (id) out.push(id); }
    const last = strv(batch[batch.length - 1]?.id);
    if (!last || last === sinceId) break;
    sinceId = last;
    if (batch.length < 250) break;
  }
  return { ok: true, productIds: out };
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
    // Ưu tiên collects (có collect id để remove); chết thì fallback products.json?collection_id=.
    let entries: { collectId: string; productId: string }[] = [];
    const viaCollects = await fetchCollects(ctx.cred, collectionId);
    if (viaCollects.ok) entries = viaCollects.collects;
    else {
      const viaProducts = await fetchCollectionProductIds(ctx.cred, collectionId);
      if (!viaProducts.ok) return NextResponse.json({ ok: false, error: `Cannot read collection products · collects.json → ${viaCollects.err} · products.json?collection_id → ${viaProducts.err}` });
      entries = viaProducts.productIds.map((pid) => ({ collectId: "", productId: pid }));
    }
    const pids = entries.map((c) => c.productId).filter(Boolean);
    const locals = pids.length
      ? await db.select({
          id: schema.shopbaseProducts.id, pid: schema.shopbaseProducts.shopbaseProductId,
          title: schema.shopbaseProducts.title, status: schema.shopbaseProducts.status,
          images: schema.shopbaseProducts.images, onlineStoreUrl: schema.shopbaseProducts.onlineStoreUrl,
        }).from(schema.shopbaseProducts)
          .where(and(eq(schema.shopbaseProducts.storeId, storeId), inArray(schema.shopbaseProducts.shopbaseProductId, pids)))
      : [];
    const byPid = new Map(locals.map((l) => [l.pid, l]));
    const products = entries.map((c) => {
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
  }

  // ── Danh sách collection ───────────────────────────────────────────────
  const list = await listCollections(ctx.cred);
  if (!list.ok) return NextResponse.json({ ok: false, error: list.error });
  return NextResponse.json({ ok: true, collections: list.collections, flavor: list.flavor });
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
      // Dò path create: custom_collections.json → collections.json.
      const viaLegacy = await tryPath(ctx.cred, "custom_collections.json", (j) => (j.custom_collection && typeof j.custom_collection === "object" ? j.custom_collection as Record<string, unknown> : null),
        { method: "POST", body: JSON.stringify({ custom_collection: { title } }) });
      if (viaLegacy.ok) return NextResponse.json({ ok: true, collection: normCol(viaLegacy.data, "custom") });
      const viaUnified = await tryPath(ctx.cred, "collections.json", (j) => (j.collection && typeof j.collection === "object" ? j.collection as Record<string, unknown> : null),
        { method: "POST", body: JSON.stringify({ collection: { title } }) });
      if (viaUnified.ok) return NextResponse.json({ ok: true, collection: normCol(viaUnified.data, "custom") });
      return NextResponse.json({ ok: false, error: `Create failed · custom_collections.json → ${viaLegacy.err} · collections.json → ${viaUnified.err}` });
    }

    const collectionId = strv(b?.collectionId);
    if (!collectionId) return NextResponse.json({ ok: false, error: "collectionId required" }, { status: 400 });

    if (action === "delete") {
      const viaLegacy = await tryPath(ctx.cred, `custom_collections/${collectionId}.json`, () => ({}), { method: "DELETE" });
      if (!viaLegacy.ok) {
        const viaUnified = await tryPath(ctx.cred, `collections/${collectionId}.json`, () => ({}), { method: "DELETE" });
        if (!viaUnified.ok) return NextResponse.json({ ok: false, error: `Delete failed · custom_collections/{id} → ${viaLegacy.err} · collections/{id} → ${viaUnified.err}` });
      }
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
        const viaCollects = await fetchCollects(ctx.cred, collectionId);
        if (!viaCollects.ok) return NextResponse.json({ ok: false, error: `Remove needs collects.json which this store does not expose (→ ${viaCollects.err})` });
        const collectByPid = new Map(viaCollects.collects.map((c) => [c.productId, c.collectId]));
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
