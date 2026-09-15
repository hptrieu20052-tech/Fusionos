import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds, sharedStoreIds, adminUserIds } from "@/lib/scope";
import { wooApi, wooApiFull, wooConfigured, type WooCred } from "@/lib/woocommerce";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/woo-products — Manage Products WooCommerce (v497). Đọc/ghi TRỰC TIẾP qua Woo REST
 * (không sync bảng riêng như ShopBase — trang luôn hiển thị dữ liệu sống trên store).
 *   GET  ?storeId=&search=&page=&productId=  — danh sách / chi tiết 1 sản phẩm
 *   POST { storeId, product }                — tạo sản phẩm mới (Publish hoặc Draft)
 *   PUT  { storeId, productId, product }     — sửa sản phẩm
 * Seller chỉ thấy/sửa store của mình (storeOwnerScopeIds).
 */

type StoreRow = { id: string; name: string; sellerId: string | null; cred: WooCred; scoped: boolean };

async function wooStore(session: NonNullable<Awaited<ReturnType<typeof getSession>>>, storeId: string): Promise<StoreRow | { error: string; status: number }> {
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
  if (!wooConfigured(cred)) return { error: "Store chưa cấu hình WooCommerce API — vào Stores nhập Store URL + Consumer key/secret.", status: 400 };
  return { id: s.id, name: s.name, sellerId: s.sellerId, cred, scoped: !!scopeIds };
}

const strv = (v: unknown) => (v == null ? "" : String(v)).trim();
// Woo trả tên kèm HTML entity ("Back to School &amp; Teacher") → decode khi đọc.
const deent = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&#0?38;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#8217;/g, "\u2019").replace(/&nbsp;/g, " ");

function slimProduct(p: Record<string, unknown>) {
  const imgs = (Array.isArray(p.images) ? p.images : []) as Record<string, unknown>[];
  const cats = (Array.isArray(p.categories) ? p.categories : []) as Record<string, unknown>[];
  return {
    id: Number(p.id) || 0,
    name: deent(strv(p.name)),
    sku: strv(p.sku),
    status: strv(p.status),                       // publish | draft | pending | private
    price: strv(p.price), regularPrice: strv(p.regular_price), salePrice: strv(p.sale_price),
    permalink: strv(p.permalink),
    thumb: strv(imgs[0]?.src),
    images: imgs.map((i) => ({ id: Number(i.id) || 0, src: strv(i.src) })),
    categories: cats.filter((c) => strv(c.slug ?? c.name).toLowerCase() !== "uncategorized" && deent(strv(c.name)) !== "Uncategorized").map((c) => ({ id: Number(c.id) || 0, name: deent(strv(c.name)) })),
    description: strv(p.description),
    tags: ((Array.isArray(p.tags) ? p.tags : []) as Record<string, unknown>[]).map((t) => strv(t.name)).filter(Boolean),
    totalSales: Number(p.total_sales) || 0,
    dateCreated: strv(p.date_created),
  };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const q = req.nextUrl.searchParams;
  const st = await wooStore(session, String(q.get("storeId") ?? ""));
  if ("error" in st) return NextResponse.json({ ok: false, error: st.error }, { status: st.status });

  try {
    const productId = String(q.get("productId") ?? "").replace(/\D/g, "");
    if (productId) {
      const p = (await wooApi(st.cred, `products/${productId}`)) as Record<string, unknown>;
      return NextResponse.json({ ok: true, product: slimProduct(p) });
    }
    // v501 · phân trang 20/trang như ShopBase; status lọc SERVER-SIDE để tổng số đúng theo filter.
    const page = Math.min(Math.max(Number(q.get("page")) || 1, 1), 500);
    const status = strv(q.get("status"));
    const qs = new URLSearchParams({ per_page: "20", page: String(page), orderby: "date", order: "desc" });
    qs.set("status", ["publish", "draft", "pending", "private"].includes(status) ? status : "any");
    const search = strv(q.get("search"));
    if (search) qs.set("search", search);
    const catId = String(q.get("category") ?? "").replace(/\D/g, "");
    if (catId) qs.set("category", catId);
    const r = await wooApiFull(st.cred, `products?${qs}`);
    const list = (Array.isArray(r.data) ? r.data : []) as Record<string, unknown>[];
    let products = list.map(slimProduct).map((p) => ({ ...p, editable: true }));
    // v503 · "Của ai người đó thấy" (mirror v459 ShopBase): seller trong store share chỉ thấy
    // sản phẩm MÌNH tạo qua FUSION + sản phẩm của admin/import (thấy, không sửa). Owner lấy từ
    // bảng woo_product_owners; không có dòng = coi như admin tạo/sync.
    if (st.scoped && products.length) {
      try {
        const owners = await db.select().from(schema.wooProductOwners)
          .where(and(eq(schema.wooProductOwners.storeId, st.id), inArray(schema.wooProductOwners.productId, products.map((p) => p.id))));
        const ownerMap = new Map(owners.map((o) => [o.productId, o.createdBy]));
        const admins = await adminUserIds();
        products = products
          .filter((p) => { const o = ownerMap.get(p.id); return !o || o === session.sub || admins.includes(o); })
          .map((p) => { const o = ownerMap.get(p.id); return { ...p, editable: o === session.sub }; });
      } catch { /* bảng chưa migrate → không lọc (mọi seller thấy hết như trước) */ }
    }
    return NextResponse.json({ ok: true, products, total: r.total, totalPages: r.totalPages, page });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 200 });
  }
}

// Body sản phẩm gửi lên Woo — chỉ nhận field cho phép, không forward mù.
type InProduct = { name?: string; description?: string; regularPrice?: string; salePrice?: string; sku?: string; status?: string; categoryIds?: number[]; tags?: string[]; images?: string[] };
function wooBody(p: InProduct): Record<string, unknown> {
  const body: Record<string, unknown> = { type: "simple" };
  if (p.name != null) body.name = strv(p.name).slice(0, 300);
  if (p.description != null) body.description = String(p.description).slice(0, 60000);
  if (p.regularPrice != null) body.regular_price = strv(p.regularPrice);
  if (p.salePrice != null) body.sale_price = strv(p.salePrice); // "" = bỏ sale
  if (p.sku != null) body.sku = strv(p.sku).slice(0, 100);
  if (p.status != null && ["publish", "draft", "pending", "private"].includes(String(p.status))) body.status = p.status;
  if (Array.isArray(p.categoryIds)) body.categories = p.categoryIds.map((id) => ({ id: Number(id) })).filter((c) => c.id > 0).slice(0, 20);
  if (Array.isArray(p.tags)) body.tags = p.tags.map((t) => ({ name: strv(t).slice(0, 80) })).filter((t) => t.name).slice(0, 30);
  if (Array.isArray(p.images)) body.images = p.images.map((src) => ({ src: strv(src) })).filter((i) => /^https?:\/\//i.test(i.src)).slice(0, 12);
  return body;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const st = await wooStore(session, String(b?.storeId ?? ""));
  if ("error" in st) return NextResponse.json({ ok: false, error: st.error }, { status: st.status });

  const p = (b?.product ?? {}) as InProduct;
  if (!strv(p.name)) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
  try {
    const created = (await wooApi(st.cred, "products", { method: "POST", body: JSON.stringify(wooBody(p)) })) as Record<string, unknown>;
    const slim = slimProduct(created);
    // v503 · ghi chủ sở hữu — nền tảng cho "của ai người đó thấy" trong store share.
    try { await db.insert(schema.wooProductOwners).values({ storeId: st.id, productId: slim.id, createdBy: session.sub }).onConflictDoNothing(); } catch { /* chưa migrate → bỏ qua */ }
    return NextResponse.json({ ok: true, product: slim });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 200 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const st = await wooStore(session, String(b?.storeId ?? ""));
  if ("error" in st) return NextResponse.json({ ok: false, error: st.error }, { status: st.status });

  const productId = String(b?.productId ?? "").replace(/\D/g, "");
  if (!productId) return NextResponse.json({ ok: false, error: "missing productId" }, { status: 400 });
  // v503 · seller trong scope chỉ SỬA sản phẩm mình tạo (đồ admin/import: thấy nhưng không sửa).
  if (st.scoped) {
    try {
      const [o] = await db.select().from(schema.wooProductOwners)
        .where(and(eq(schema.wooProductOwners.storeId, st.id), eq(schema.wooProductOwners.productId, Number(productId)))).limit(1);
      if (!o || o.createdBy !== session.sub) return NextResponse.json({ ok: false, error: "This product wasn't created by you — only your own listings can be edited." }, { status: 403 });
    } catch { /* chưa migrate → giữ hành vi cũ */ }
  }
  try {
    const updated = (await wooApi(st.cred, `products/${productId}`, { method: "PUT", body: JSON.stringify(wooBody((b?.product ?? {}) as InProduct)) })) as Record<string, unknown>;
    return NextResponse.json({ ok: true, product: slimProduct(updated) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 200 });
  }
}

/** v501 · PATCH { storeId, ids[], status } — bulk đổi trạng thái (Woo products/batch, tối đa 50/lần). */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const st = await wooStore(session, String(b?.storeId ?? ""));
  if ("error" in st) return NextResponse.json({ ok: false, error: st.error }, { status: st.status });

  const status = String(b?.status ?? "");
  if (!["publish", "draft"].includes(status)) return NextResponse.json({ ok: false, error: "invalid status" }, { status: 400 });
  let ids = (Array.isArray(b?.ids) ? b.ids : []).map((x: unknown) => Number(x)).filter((n: number) => n > 0).slice(0, 50);
  if (!ids.length) return NextResponse.json({ ok: false, error: "no products selected" }, { status: 400 });
  // v503 · scoped seller: bulk chỉ áp lên sản phẩm MÌNH tạo.
  if (st.scoped) {
    try {
      const owners = await db.select().from(schema.wooProductOwners)
        .where(and(eq(schema.wooProductOwners.storeId, st.id), inArray(schema.wooProductOwners.productId, ids)));
      const mine = new Set(owners.filter((o) => o.createdBy === session.sub).map((o) => o.productId));
      ids = ids.filter((id: number) => mine.has(id));
      if (!ids.length) return NextResponse.json({ ok: false, error: "None of the selected products were created by you." }, { status: 403 });
    } catch { /* chưa migrate → giữ hành vi cũ */ }
  }
  try {
    await wooApi(st.cred, "products/batch", { method: "POST", body: JSON.stringify({ update: ids.map((id: number) => ({ id, status })) }) });
    return NextResponse.json({ ok: true, updated: ids.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 200 });
  }
}
