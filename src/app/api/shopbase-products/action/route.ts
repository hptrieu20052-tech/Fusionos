import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopbaseApi, shopbaseConfigured, type ShopBaseCred } from "@/lib/shopbase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/shopbase-products/action { action, ids[], tags? }
 * Bulk thao tác sản phẩm ShopBase QUA REST API (PUT/DELETE /admin/products/{id}.json).
 *   publish      → { product: { published: true } }   → local status ACTIVE
 *   unpublish    → { product: { published: false } }  → local status DRAFT
 *   addTags      → gộp tag (không trùng) → PUT tags    → local tags
 *   removeTags   → bỏ tag khớp           → PUT tags    → local tags
 *   delete       → DELETE product        → xoá local row (KHÔNG hoàn tác)
 * Gom theo store để nạp credential 1 lần/store; trả về số thành công + danh sách lỗi.
 * Độc lập hệ Shopify.
 */
type Action = "publish" | "unpublish" | "addTags" | "removeTags" | "delete";
const ACTIONS = new Set<Action>(["publish", "unpublish", "addTags", "removeTags", "delete"]);
const MAX_IDS = 250; // trần 1 lần gọi để không vượt maxDuration 60s

const tagList = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);
const mergeTags = (cur: string, add: string[]) => {
  const m = new Map<string, string>();
  for (const t of tagList(cur)) m.set(t.toLowerCase(), t);
  for (const t of add) if (!m.has(t.toLowerCase())) m.set(t.toLowerCase(), t);
  return Array.from(m.values()).join(", ");
};
const stripTags = (cur: string, rm: string[]) => {
  const bad = new Set(rm.map((t) => t.toLowerCase()));
  return tagList(cur).filter((t) => !bad.has(t.toLowerCase())).join(", ");
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const action = String(b?.action ?? "") as Action;
  const ids = Array.isArray(b?.ids) ? Array.from(new Set(b.ids.map((x: unknown) => String(x)).filter(Boolean))) : [];
  const tags = tagList(String(b?.tags ?? ""));

  if (!ACTIONS.has(action)) return NextResponse.json({ ok: false, error: "hành động không hợp lệ" }, { status: 400 });
  if (!ids.length) return NextResponse.json({ ok: false, error: "chưa chọn sản phẩm" }, { status: 400 });
  if (ids.length > MAX_IDS) return NextResponse.json({ ok: false, error: `chọn tối đa ${MAX_IDS} sản phẩm/lần` }, { status: 400 });
  if ((action === "addTags" || action === "removeTags") && !tags.length) return NextResponse.json({ ok: false, error: "chưa nhập tag" }, { status: 400 });

  const rows = await db.select({
    id: schema.shopbaseProducts.id,
    storeId: schema.shopbaseProducts.storeId,
    pid: schema.shopbaseProducts.shopbaseProductId,
    tags: schema.shopbaseProducts.tags,
    sellerId: schema.stores.sellerId,
    marketplace: schema.stores.marketplace,
  }).from(schema.shopbaseProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopbaseProducts.storeId))
    .where(inArray(schema.shopbaseProducts.id, ids as string[]));

  // Phân quyền: seller chỉ thao tác sản phẩm thuộc store của mình.
  const scopeIds = await storeOwnerScopeIds(session);
  const allowed = rows.filter((r) => r.marketplace === "shopbase" && (!scopeIds || (r.sellerId && scopeIds.includes(r.sellerId))));
  if (!allowed.length) return NextResponse.json({ ok: false, error: "không có sản phẩm hợp lệ" }, { status: 400 });

  // Gom theo store.
  const byStore = new Map<string, typeof allowed>();
  for (const r of allowed) { const a = byStore.get(r.storeId) ?? []; a.push(r); byStore.set(r.storeId, a); }

  const credCache = new Map<string, ShopBaseCred | null>();
  const loadCred = async (storeId: string): Promise<ShopBaseCred | null> => {
    if (credCache.has(storeId)) return credCache.get(storeId) ?? null;
    const [s] = await db.select({ cred: schema.stores.apiCredentials }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    const cred = (((s?.cred ?? {}) as Record<string, unknown>).shopbase ?? null) as ShopBaseCred | null;
    credCache.set(storeId, cred);
    return cred;
  };

  let done = 0;
  const failed: { id: string; error: string }[] = [];

  for (const [storeId, list] of Array.from(byStore.entries())) {
    const cred = await loadCred(storeId);
    if (!shopbaseConfigured(cred)) { for (const r of list) failed.push({ id: r.id, error: "store chưa cấu hình API" }); continue; }
    for (const r of list) {
      const pidNum = Number(r.pid);
      const pid = Number.isFinite(pidNum) && String(pidNum) === r.pid ? pidNum : r.pid;
      try {
        if (action === "delete") {
          await shopbaseApi(cred!, `products/${r.pid}.json`, { method: "DELETE" });
          await db.delete(schema.shopbaseProducts).where(eq(schema.shopbaseProducts.id, r.id));
        } else if (action === "publish" || action === "unpublish") {
          const published = action === "publish";
          await shopbaseApi(cred!, `products/${r.pid}.json`, { method: "PUT", body: JSON.stringify({ product: { id: pid, published } }) });
          await db.update(schema.shopbaseProducts).set({ status: published ? "ACTIVE" : "DRAFT", updatedAt: new Date() }).where(eq(schema.shopbaseProducts.id, r.id));
        } else {
          const next = action === "addTags" ? mergeTags(r.tags ?? "", tags) : stripTags(r.tags ?? "", tags);
          await shopbaseApi(cred!, `products/${r.pid}.json`, { method: "PUT", body: JSON.stringify({ product: { id: pid, tags: next } }) });
          await db.update(schema.shopbaseProducts).set({ tags: next, updatedAt: new Date() }).where(eq(schema.shopbaseProducts.id, r.id));
        }
        done++;
      } catch (e) {
        failed.push({ id: r.id, error: String((e as Error)?.message ?? e).slice(0, 180) });
      }
    }
  }

  return NextResponse.json({ ok: true, action, done, failed, total: allowed.length });
}
