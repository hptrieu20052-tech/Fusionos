import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds, sharedStoreIds } from "@/lib/scope";
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
type Action = "publish" | "unpublish" | "addTags" | "removeTags" | "delete" | "duplicate";
const ACTIONS = new Set<Action>(["publish", "unpublish", "addTags", "removeTags", "delete", "duplicate"]);
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
    createdBy: schema.shopbaseProducts.createdBy,
    sellerId: schema.stores.sellerId,
    marketplace: schema.stores.marketplace,
  }).from(schema.shopbaseProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopbaseProducts.storeId))
    .where(inArray(schema.shopbaseProducts.id, ids as string[]));

  // Phân quyền: seller chỉ thao tác sản phẩm thuộc store của mình.
  const scopeIds = await storeOwnerScopeIds(session);
  const shared = await sharedStoreIds(scopeIds);
  let allowed = rows.filter((r) => r.marketplace === "shopbase" && (!scopeIds || (r.sellerId && scopeIds.includes(r.sellerId)) || shared.includes(r.storeId))); // v459: store không chủ → cần được share (bỏ quy tắc store chung)
  // v435 · Store chung: seller CHỈ publish/tag/xoá listing MÌNH tạo — của admin/người khác thì không
  // (Dup thì được: tạo bản copy của riêng mình, không đụng bản gốc).
  const ownFailed: { id: string; error: string }[] = [];
  if (session.role !== "admin" && action !== "duplicate") {
    for (const r of allowed) if (r.createdBy !== session.sub) ownFailed.push({ id: r.id, error: "listing của người khác — chỉ người tạo hoặc admin thao tác được" });
    allowed = allowed.filter((r) => r.createdBy === session.sub);
  }
  if (!allowed.length) return NextResponse.json(ownFailed.length ? { ok: true, action, done: 0, failed: ownFailed, total: ownFailed.length } : { ok: false, error: "không có sản phẩm hợp lệ" }, { status: ownFailed.length ? 200 : 400 });

  // v426 · duplicate — nhân bản LOCAL thành BẢN NHÁP staged (pid = ''): sửa thoải mái rồi Push
  // như listing mới. Không gọi ShopBase; bỏ id variant/image của bản gốc để Push tạo mới sạch.
  if (action === "duplicate") {
    let dupDone = 0;
    const dupFailed: { id: string; error: string }[] = [];
    const created: { src: string; id: string }[] = [];   // v434 · trả id bản copy để client mở Card Detail luôn
    const full = await db.select().from(schema.shopbaseProducts)
      .where(inArray(schema.shopbaseProducts.id, allowed.map((r) => r.id)));
    const stripIds = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => {
      const o = { ...(x as Record<string, unknown>) }; delete o.id; delete o.product_id; delete o.productId; return o;
    });
    for (const p of full) {
      try {
        const [row] = await db.insert(schema.shopbaseProducts).values({
          storeId: p.storeId, shopbaseProductId: "", handle: "",
          title: `${p.title} (copy)`, bodyHtml: p.bodyHtml, vendor: p.vendor, productType: p.productType,
          tags: p.tags, status: "DRAFT", seoTitle: p.seoTitle, seoDescription: p.seoDescription,
          collections: p.collections ?? [], options: p.options ?? [],
          variants: stripIds(p.variants), images: stripIds(p.images),
          onlineStoreUrl: null, totalInventory: null, dirty: true,
          etsyProductId: null, tiktokProductId: null, templateId: p.templateId ?? null,
          createdBy: session.sub, pushedAt: null,
        }).returning({ id: schema.shopbaseProducts.id });
        created.push({ src: p.id, id: row.id });
        dupDone++;
      } catch (e) { dupFailed.push({ id: p.id, error: String((e as Error)?.message ?? e).slice(0, 180) }); }
    }
    return NextResponse.json({ ok: true, action, done: dupDone, failed: dupFailed, total: allowed.length, created });
  }

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
        // v405 · BẢN NHÁP stage (pid = '') chưa có trên ShopBase → thao tác LOCAL, không gọi API.
        if (!r.pid) {
          if (action === "delete") {
            await db.delete(schema.shopbaseProducts).where(eq(schema.shopbaseProducts.id, r.id));
          } else if (action === "publish" || action === "unpublish") {
            // Nháp không publish được — phải Push trước. unpublish = no-op (nháp sẵn DRAFT).
            if (action === "publish") throw new Error("draft not on ShopBase yet — Push to ShopBase first");
          } else {
            const next = action === "addTags" ? mergeTags(r.tags ?? "", tags) : stripTags(r.tags ?? "", tags);
            await db.update(schema.shopbaseProducts).set({ tags: next, updatedAt: new Date() }).where(eq(schema.shopbaseProducts.id, r.id));
          }
          done++;
          continue;
        }
        if (action === "delete") {
          await shopbaseApi(cred!, `products/${r.pid}.json`, { method: "DELETE" });
          await db.delete(schema.shopbaseProducts).where(eq(schema.shopbaseProducts.id, r.id));
        } else if (action === "publish" || action === "unpublish") {
          const published = action === "publish";
          // v427 · Theo ĐÚNG docs ShopBase (rest-api-references): body CHỈ { id, published } —
          // KHÔNG kèm published_at (kèm theo kiểu Shopify legacy có thể bị reset về null → no-op).
          // Xác minh bằng GET đọc lại; nếu chưa ăn, thử lần 2 kèm published_at rồi mới báo lỗi.
          // v430 · Field publish THẬT của ShopBase là `product_availability` (1 = Available, 0 = Unavailable)
          // — KHÔNG có trong docs; dò ra bằng cách diff JSON sản phẩm trước/sau khi bật tay trong admin.
          // `published`/`published_at` chỉ là hệ quả đọc ra, PUT vào chúng bị ShopBase bỏ qua (đã thử 2 cách).
          const readState = async () => {
            const chk = await shopbaseApi(cred!, `products/${r.pid}.json`);
            const cp = (chk?.product ?? null) as Record<string, unknown> | null;
            const liveAt = cp ? String(cp.published_at ?? "").replace(/^null$/, "").trim() : "";
            const known = !!cp && ("product_availability" in cp || "published" in cp || "published_at" in cp);
            const isPub = cp ? (cp.product_availability === 1 || cp.published === true || !!liveAt) : false;
            return { cp, liveAt, known, isPub };
          };
          await shopbaseApi(cred!, `products/${r.pid}.json`, {
            method: "PUT",
            body: JSON.stringify({ product: { id: pid, product_availability: published ? 1 : 0, published } }),
          });
          let st = await readState();
          if (st.known && st.isPub !== published) {
            await shopbaseApi(cred!, `products/${r.pid}.json`, {
              method: "PUT",
              body: JSON.stringify({ product: { id: pid, published, published_at: published ? new Date().toISOString() : null } }),
            });
            st = await readState();
            if (st.known && st.isPub !== published) {
              throw new Error(`ShopBase vẫn trả product_availability=${String(st.cp?.product_availability)} · published=${String(st.cp?.published)} sau 2 cách gửi — báo lại để dò tiếp`);
            }
          }
          await db.update(schema.shopbaseProducts).set({ status: published ? "ACTIVE" : "DRAFT", updatedAt: new Date() }).where(eq(schema.shopbaseProducts.id, r.id));
        } else {
          // v465 · GẮN/GỠ TAG có XÁC MINH. ShopBase từng trả 200 nhưng KHÔNG lưu field (xem publish
          // v427/v430) → trước đây FUSION ghi local trong khi live không có tag ⇒ smart collection rỗng.
          // Nay: PUT → GET đọc lại → chưa dính thì thử dạng MẢNG → vẫn không thì BÁO LỖI, không ghi local.
          const next = action === "addTags" ? mergeTags(r.tags ?? "", tags) : stripTags(r.tags ?? "", tags);
          const readLiveTags = async (): Promise<Set<string>> => {
            const chk = await shopbaseApi(cred!, `products/${r.pid}.json`);
            const cp = (chk?.product ?? null) as Record<string, unknown> | null;
            const raw = cp?.tags;
            const arr = Array.isArray(raw) ? raw.map((x) => String(x)) : String(raw ?? "").split(",");
            return new Set(arr.map((t) => t.trim().toLowerCase()).filter(Boolean));
          };
          const wanted = tags.map((t) => t.toLowerCase());
          const ok = (live: Set<string>) => action === "addTags"
            ? wanted.every((t) => live.has(t))          // add: mọi tag phải CÓ mặt
            : wanted.every((t) => !live.has(t));         // remove: mọi tag phải VẮNG mặt
          // Lần 1: tags dạng chuỗi (Shopify-style)
          await shopbaseApi(cred!, `products/${r.pid}.json`, { method: "PUT", body: JSON.stringify({ product: { id: pid, tags: next } }) });
          let live = await readLiveTags();
          if (!ok(live)) {
            // Lần 2: tags dạng MẢNG (ShopBase quirk)
            await shopbaseApi(cred!, `products/${r.pid}.json`, { method: "PUT", body: JSON.stringify({ product: { id: pid, tags: tagList(next) } }) });
            live = await readLiveTags();
            if (!ok(live)) {
              throw new Error(`ShopBase nhận request nhưng tag KHÔNG được lưu (tag live hiện tại: "${Array.from(live).join(", ") || "(trống)"}") — định dạng field 'tags' có thể khác, báo lại để dò tiếp`);
            }
          }
          // Local phản ánh ĐÚNG trạng thái live đã xác minh.
          await db.update(schema.shopbaseProducts).set({ tags: next, updatedAt: new Date() }).where(eq(schema.shopbaseProducts.id, r.id));
        }
        done++;
      } catch (e) {
        failed.push({ id: r.id, error: String((e as Error)?.message ?? e).slice(0, 180) });
      }
    }
  }

  return NextResponse.json({ ok: true, action, done, failed: [...ownFailed, ...failed], total: allowed.length + ownFailed.length });
}
