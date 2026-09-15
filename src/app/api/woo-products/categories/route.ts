import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds, sharedStoreIds } from "@/lib/scope";
import { wooApi, wooConfigured, type WooCred } from "@/lib/woocommerce";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/woo-products/categories — quản lý category WooCommerce từ FUSION (v497, quyền v513).
 *   GET  ?storeId=            — category seller ĐƯỢC THẤY: của admin + của mình (bảng woo_category_owners)
 *   POST { storeId, name, parentId? } — tạo category mới; seller tạo → ghi chủ sở hữu (riêng của seller)
 * LƯU Ý: category là taxonomy THẬT trên Woo — "riêng" ở đây là riêng trong FUSION
 * (seller khác không thấy trong chip/filter); ngoài site nó vẫn là category bình thường.
 */
type StoreCtx = { id: string; cred: WooCred; scoped: boolean };
async function wooCred(session: NonNullable<Awaited<ReturnType<typeof getSession>>>, storeId: string): Promise<StoreCtx | { error: string; status: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return { error: "missing storeId", status: 400 };
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!s) return { error: "store not found", status: 404 };
  if (s.marketplace !== "woocommerce") return { error: "not a WooCommerce store", status: 400 };
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && !(s.sellerId && scopeIds.includes(s.sellerId))) {
    const shared = await sharedStoreIds(scopeIds);    // v498 · store share (store_members) cũng dùng được
    if (!shared.includes(s.id)) return { error: "forbidden", status: 403 };
  }
  const cred = (((s.apiCredentials ?? {}) as Record<string, unknown>).woocommerce ?? {}) as WooCred;
  if (!wooConfigured(cred)) return { error: "Store chưa cấu hình WooCommerce API.", status: 400 };
  return { id: s.id, cred, scoped: !!scopeIds };
}

/** Đọc bảng chủ sở hữu category. null = chưa migrate v513. */
async function catOwners(storeId: string): Promise<Map<number, string | null> | null> {
  try {
    const rows = await db.select({ categoryId: schema.wooCategoryOwners.categoryId, createdBy: schema.wooCategoryOwners.createdBy })
      .from(schema.wooCategoryOwners).where(eq(schema.wooCategoryOwners.storeId, storeId));
    return new Map(rows.map((r) => [r.categoryId, r.createdBy]));
  } catch { return null; }
}

const strv = (v: unknown) => (v == null ? "" : String(v)).trim();
// Woo trả tên kèm HTML entity ("Back to School &amp; Teacher") → decode khi đọc.
const deent = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&#0?38;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#8217;/g, "\u2019").replace(/&nbsp;/g, " ");

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const ctx = await wooCred(session, String(req.nextUrl.searchParams.get("storeId") ?? ""));
  if ("error" in ctx) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
  const cred = ctx.cred;

  try {
    // 100/trang là dư cho store thường; lấy tối đa 3 trang (300 category).
    const all: Record<string, unknown>[] = [];
    for (let page = 1; page <= 3; page++) {
      const batch = (await wooApi(cred, `products/categories?per_page=100&page=${page}&orderby=name`)) as Record<string, unknown>[];
      if (!Array.isArray(batch) || !batch.length) break;
      all.push(...batch);
      if (batch.length < 100) break;
    }
    const categories = all.map((c) => ({
      id: Number(c.id) || 0,
      name: deent(strv(c.name)),
      parent: Number(c.parent) || 0,
      count: Number(c.count) || 0,
      slug: strv(c.slug),
    })).filter((c) => c.slug !== "uncategorized");
    // v513 · "của ai người đó thấy": category không có chủ = của admin (ai cũng thấy);
    // có chủ = riêng seller đó — seller khác không thấy trong FUSION. Admin thấy tất.
    let out = categories;
    const owners = await catOwners(ctx.id);
    if (ctx.scoped && owners) {
      out = categories.filter((c) => { const o = owners.get(c.id); return o == null || o === session.sub; });
    }
    // Nhãn người tạo cho admin xem (và để UI có thể hiển thị "by …" nếu muốn).
    if (owners && owners.size) {
      const uids = Array.from(new Set(Array.from(owners.values()).filter((x): x is string => !!x)));
      const names = uids.length
        ? new Map((await db.select({ id: schema.users.id, name: schema.users.fullName }).from(schema.users).where(inArray(schema.users.id, uids))).map((u) => [u.id, u.name ?? ""]))
        : new Map<string, string>();
      out = out.map((c) => { const o = owners.get(c.id); return o ? { ...c, ownerName: names.get(o) || "seller" } : c; });
    }
    return NextResponse.json({ ok: true, categories: out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const ctx = await wooCred(session, String(b?.storeId ?? ""));
  if ("error" in ctx) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
  const cred = ctx.cred;

  const name = strv(b?.name).slice(0, 120);
  if (!name) return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
  const parentId = Number(b?.parentId) || 0;
  try {
    const c = (await wooApi(cred, "products/categories", {
      method: "POST",
      body: JSON.stringify({ name, ...(parentId > 0 ? { parent: parentId } : {}) }),
    })) as Record<string, unknown>;
    const cid = Number(c.id) || 0;
    // v513 · seller tạo → category RIÊNG của seller đó (admin tạo = dùng chung, không ghi dòng).
    let warn: string | undefined;
    if (ctx.scoped && cid > 0) {
      try { await db.insert(schema.wooCategoryOwners).values({ storeId: ctx.id, categoryId: cid, createdBy: session.sub }).onConflictDoNothing(); }
      catch { warn = "Category created as SHARED — run MIGRATION_v513_woo_category_owners.sql on Supabase to enable seller-private categories."; }
    }
    return NextResponse.json({ ok: true, category: { id: cid, name: deent(strv(c.name)), parent: Number(c.parent) || 0, count: 0, slug: strv(c.slug) }, ...(warn ? { warn } : {}) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 200 });
  }
}
