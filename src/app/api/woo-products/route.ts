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
  // v505 · meta _wcp_selected_styles của Woo Custom Pro = product này bán những Product Type nào.
  const meta = (Array.isArray(p.meta_data) ? p.meta_data : []) as Record<string, unknown>[];
  const wcpRaw = meta.find((m) => strv(m.key) === "_wcp_selected_styles")?.value;
  const wcpStyles = (Array.isArray(wcpRaw) ? wcpRaw : []).map((x) => strv(x)).filter(Boolean);
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
    wcpStyles, // [] = hiện tất cả style (mặc định plugin)
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
    // v504 · lọc theo SELLER (người tạo) / TEMPLATE: tra bảng woo_product_owners → Woo `include=ids`.
    const fSeller = String(q.get("seller") ?? "");
    const fTemplate = String(q.get("template") ?? "");
    if (/^[0-9a-f-]{36}$/i.test(fSeller) || /^[0-9a-f-]{36}$/i.test(fTemplate)) {
      try {
        const conds = [eq(schema.wooProductOwners.storeId, st.id)];
        if (/^[0-9a-f-]{36}$/i.test(fSeller)) conds.push(eq(schema.wooProductOwners.createdBy, fSeller));
        if (/^[0-9a-f-]{36}$/i.test(fTemplate)) conds.push(eq(schema.wooProductOwners.templateId, fTemplate));
        const rows = await db.select({ pid: schema.wooProductOwners.productId }).from(schema.wooProductOwners).where(and(...conds));
        const ids = rows.map((x) => x.pid).slice(0, 100);
        if (!ids.length) return NextResponse.json({ ok: true, products: [], total: 0, totalPages: 1, page: 1 });
        qs.set("include", ids.join(","));
      } catch { /* chưa migrate → bỏ qua filter */ }
    }
    const r = await wooApiFull(st.cred, `products?${qs}`);
    const list = (Array.isArray(r.data) ? r.data : []) as Record<string, unknown>[];
    let products = list.map(slimProduct).map((p) => ({ ...p, editable: true, creator: "", tplName: "" }));
    // v503 · "Của ai người đó thấy" (mirror v459 ShopBase) + v504 · hiện TÊN người tạo trong cột Seller.
    if (products.length) {
      try {
        const owners = await db.select().from(schema.wooProductOwners)
          .where(and(eq(schema.wooProductOwners.storeId, st.id), inArray(schema.wooProductOwners.productId, products.map((p) => p.id))));
        const ownerMap = new Map(owners.map((o) => [o.productId, o.createdBy]));
        const userIds = Array.from(new Set(owners.map((o) => o.createdBy).filter((x): x is string => !!x)));
        const names = userIds.length
          ? new Map((await db.select({ id: schema.users.id, name: schema.users.fullName }).from(schema.users).where(inArray(schema.users.id, userIds))).map((u) => [u.id, u.name ?? ""]))
          : new Map<string, string>();
        // v511 · tên template đã dùng khi tạo → dòng "tpl: …" trong cột Store/Seller (như ShopBase).
        const tplIds = Array.from(new Set(owners.map((o) => o.templateId).filter((x): x is string => !!x)));
        const tplNames = tplIds.length
          ? new Map((await db.select({ id: schema.wooTemplates.id, name: schema.wooTemplates.name }).from(schema.wooTemplates).where(inArray(schema.wooTemplates.id, tplIds))).map((t) => [t.id, t.name]))
          : new Map<string, string>();
        const tplByProduct = new Map(owners.filter((o) => o.templateId).map((o) => [o.productId, tplNames.get(o.templateId as string) ?? ""]));
        if (st.scoped) {
          const admins = await adminUserIds();
          products = products.filter((p) => { const o = ownerMap.get(p.id); return !o || o === session.sub || admins.includes(o); });
        }
        products = products.map((p) => {
          const o = ownerMap.get(p.id);
          return { ...p, editable: st.scoped ? o === session.sub : true, creator: (o && names.get(o)) || "", tplName: tplByProduct.get(p.id) || "" };
        });
      } catch { /* bảng chưa migrate → giữ nguyên */ }
    }
    return NextResponse.json({ ok: true, products, total: r.total, totalPages: r.totalPages, page, admin: !st.scoped });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 200 });
  }
}

// Body sản phẩm gửi lên Woo — chỉ nhận field cho phép, không forward mù.
type InProduct = { name?: string; description?: string; regularPrice?: string; salePrice?: string; sku?: string; status?: string; categoryIds?: number[]; tags?: string[]; images?: string[]; wcpStyles?: string[] };
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
  // v505 · Product Types: ghi meta _wcp_selected_styles → Woo Custom Pro chỉ hiện các style này
  // trên trang sản phẩm (mảng rỗng = hiện tất cả — đúng hành vi mặc định của plugin).
  if (Array.isArray(p.wcpStyles)) {
    body.meta_data = [{ key: "_wcp_selected_styles", value: p.wcpStyles.map((s) => strv(s)).filter(Boolean).slice(0, 50) }];
  }
  return body;
}

/**
 * v524 · WP tự gán CATEGORY MẶC ĐỊNH (đang là Best Seller) cho mọi sản phẩm về 0 category —
 * đó là lý do "gỡ Best Seller báo Saved mà không mất". Fix tận gốc: KHÔNG BAO GIỜ gửi
 * categories rỗng — khi rỗng, gán category "Uncategorized" (tự tạo nếu store chưa có;
 * FUSION đang ẩn slug này ở mọi nơi nên coi như không category).
 */
async function fallbackCatId(cred: WooCred): Promise<number | null> {
  try {
    const found = (await wooApi(cred, "products/categories?slug=uncategorized")) as Record<string, unknown>[];
    if (Array.isArray(found) && found[0] && Number(found[0].id) > 0) return Number(found[0].id);
    const made = (await wooApi(cred, "products/categories", { method: "POST", body: JSON.stringify({ name: "Uncategorized", slug: "uncategorized" }) })) as Record<string, unknown>;
    return Number(made?.id) > 0 ? Number(made.id) : null;
  } catch { return null; }
}
/** Áp fallback vào body trước khi gửi Woo. */
async function guardEmptyCategories(cred: WooCred, body: Record<string, unknown>): Promise<void> {
  if (Array.isArray(body.categories) && body.categories.length === 0) {
    const fid = await fallbackCatId(cred);
    if (fid) body.categories = [{ id: fid }];
    else delete body.categories; // không tạo được → thà giữ nguyên category cũ còn hơn để WP gán default
  }
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
    const createBody = wooBody(p);
    await guardEmptyCategories(st.cred, createBody);
    const created = (await wooApi(st.cred, "products", { method: "POST", body: JSON.stringify(createBody) })) as Record<string, unknown>;
    const slim = slimProduct(created);
    // v503 · ghi chủ sở hữu — nền tảng cho "của ai người đó thấy" trong store share.
    const tplId = /^[0-9a-f-]{36}$/i.test(String(b?.templateId ?? "")) ? String(b.templateId) : null;
    // v527 · ghi owner TRƯỢT là seller mất quyền sửa chính đồ mình (ca EL002) → retry 1 lần + báo rõ.
    let ownWarn: string | undefined;
    try { await db.insert(schema.wooProductOwners).values({ storeId: st.id, productId: slim.id, createdBy: session.sub, templateId: tplId }).onConflictDoNothing(); }
    catch {
      try { await db.insert(schema.wooProductOwners).values({ storeId: st.id, productId: slim.id, createdBy: session.sub, templateId: tplId }).onConflictDoNothing(); }
      catch { ownWarn = "Product created on store, but the owner record failed — ask admin to tick it → Bulk edit → Assign owner."; }
    }
    return NextResponse.json({ ok: true, product: slim, ...(ownWarn ? { warn: ownWarn } : {}) });
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
    const updateBody = wooBody((b?.product ?? {}) as InProduct);
    await guardEmptyCategories(st.cred, updateBody);
    const updated = (await wooApi(st.cred, `products/${productId}`, { method: "PUT", body: JSON.stringify(updateBody) })) as Record<string, unknown>;
    return NextResponse.json({ ok: true, product: slimProduct(updated) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 200 });
  }
}

/**
 * v501 · PATCH { storeId, ids[], status } — bulk đổi trạng thái.
 * v508 · PATCH { storeId, ids[], set:{ regularPrice?, salePrice?, description?, descriptionMode? } }
 *        — BULK EDIT giá/description (Woo products/batch, tối đa 50/lần).
 *        salePrice "0" = xoá sale · descriptionMode "append" = nối thêm vào description hiện tại.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const st = await wooStore(session, String(b?.storeId ?? ""));
  if ("error" in st) return NextResponse.json({ ok: false, error: st.error }, { status: st.status });

  const status = String(b?.status ?? "");
  const set = (b?.set ?? {}) as { regularPrice?: string; salePrice?: string; description?: string; descriptionMode?: string; wcpStyles?: string[] };
  const regularPrice = strv(set.regularPrice);
  const salePrice = strv(set.salePrice);
  const description = String(set.description ?? "");
  const descMode = set.descriptionMode === "append" ? "append" : "replace";
  // v512 · bulk gán Product Types (meta _wcp_selected_styles) — fix "thêm type mới là áp vào listing cũ":
  // gán tường minh cho hàng cũ thì type mới thêm sau không lọt vào picker của chúng nữa.
  const wcpStyles = Array.isArray(set.wcpStyles) ? set.wcpStyles.map((x) => strv(x)).filter(Boolean).slice(0, 50) : null;
  // v527 · Assign owner (chỉ admin): gán các sản phẩm đã tick cho 1 seller — sửa dòng woo_product_owners,
  // vừa cứu sản phẩm "mồ côi" owner (ghi trượt lúc tạo) vừa dùng khi admin muốn GIAO listing cho seller.
  const ownerId = /^[0-9a-f-]{36}$/i.test(String((set as { ownerId?: string }).ownerId ?? "")) ? String((set as { ownerId?: string }).ownerId) : "";
  const hasStatus = ["publish", "draft"].includes(status);
  const hasSet = !!(regularPrice || salePrice || description.trim() || wcpStyles !== null || ownerId);
  if (!hasStatus && !hasSet) return NextResponse.json({ ok: false, error: "nothing to update" }, { status: 400 });
  // (kiểm tra scoped nằm sau wooStore — chèn tại chỗ dùng)
  if (regularPrice && !(Number(regularPrice) > 0)) return NextResponse.json({ ok: false, error: "invalid price" }, { status: 400 });
  if (salePrice && salePrice !== "0" && !(Number(salePrice) > 0)) return NextResponse.json({ ok: false, error: "invalid sale price" }, { status: 400 });

  if (ownerId && st.scoped) return NextResponse.json({ ok: false, error: "Only admins can assign product owners." }, { status: 403 });
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
  const wooTouch = hasStatus || !!regularPrice || !!salePrice || !!description.trim() || wcpStyles !== null;
  try {
    if (!wooTouch) {
      // v527 · chỉ gán owner — không đụng Woo.
      for (const id of ids) {
        await db.insert(schema.wooProductOwners).values({ storeId: st.id, productId: id, createdBy: ownerId })
          .onConflictDoUpdate({ target: [schema.wooProductOwners.storeId, schema.wooProductOwners.productId], set: { createdBy: ownerId } });
      }
      return NextResponse.json({ ok: true, updated: ids.length });
    }
    // Append description → cần description hiện tại: lấy 1 phát qua include=ids.
    const curDesc = new Map<number, string>();
    if (description.trim() && descMode === "append") {
      const j = await wooApi(st.cred, `products?include=${ids.join(",")}&per_page=${ids.length}`);
      for (const p of (Array.isArray(j) ? j : []) as Record<string, unknown>[]) {
        curDesc.set(Number(p.id) || 0, strv(p.description));
      }
    }
    const update = ids.map((id: number) => {
      const u: Record<string, unknown> = { id };
      if (hasStatus) u.status = status;
      if (regularPrice) u.regular_price = regularPrice;
      if (salePrice) u.sale_price = salePrice === "0" ? "" : salePrice; // "0" = bỏ sale
      if (description.trim()) {
        u.description = descMode === "append" ? `${curDesc.get(id) ?? ""}\n${description}`.trim() : description;
      }
      if (wcpStyles !== null) u.meta_data = [{ key: "_wcp_selected_styles", value: wcpStyles }]; // [] = hiện tất cả
      return u;
    });
    await wooApi(st.cred, "products/batch", { method: "POST", body: JSON.stringify({ update }) });
    if (ownerId) {
      for (const id of ids) {
        try {
          await db.insert(schema.wooProductOwners).values({ storeId: st.id, productId: id, createdBy: ownerId })
            .onConflictDoUpdate({ target: [schema.wooProductOwners.storeId, schema.wooProductOwners.productId], set: { createdBy: ownerId } });
        } catch { /* chưa migrate */ }
      }
    }
    return NextResponse.json({ ok: true, updated: ids.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 200 });
  }
}

/**
 * v518 · DELETE ?storeId=&ids=1,2,3 — chuyển sản phẩm vào THÙNG RÁC WordPress (không xoá vĩnh viễn,
 * khôi phục được trong WP admin → Products → Trash). Tối đa 20 id/lần. Seller scoped: chỉ đồ mình tạo.
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const q = req.nextUrl.searchParams;
  const st = await wooStore(session, String(q.get("storeId") ?? ""));
  if ("error" in st) return NextResponse.json({ ok: false, error: st.error }, { status: st.status });
  let ids = String(q.get("ids") ?? "").split(",").map((x) => Number(x)).filter((n) => n > 0).slice(0, 20);
  if (!ids.length) return NextResponse.json({ ok: false, error: "no products selected" }, { status: 400 });
  if (st.scoped) {
    try {
      const owners = await db.select().from(schema.wooProductOwners)
        .where(and(eq(schema.wooProductOwners.storeId, st.id), inArray(schema.wooProductOwners.productId, ids)));
      const mine = new Set(owners.filter((o) => o.createdBy === session.sub).map((o) => o.productId));
      ids = ids.filter((id) => mine.has(id));
      if (!ids.length) return NextResponse.json({ ok: false, error: "None of the selected products were created by you." }, { status: 403 });
    } catch { /* chưa migrate → giữ hành vi cũ */ }
  }
  let deleted = 0;
  const errors: string[] = [];
  for (const id of ids) {
    try { await wooApi(st.cred, `products/${id}`, { method: "DELETE" }); deleted++; } // không force → vào Trash
    catch (e) { errors.push(`#${id}: ${String((e as Error)?.message ?? e).slice(0, 80)}`); }
  }
  return NextResponse.json({ ok: deleted > 0 || !errors.length, deleted, errors: errors.slice(0, 5) });
}
