import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopHost, type ShopifyCred } from "@/lib/shopify";
import { applyTemplate, type Template } from "@/lib/shopify-template";
import { fetchOneShopifyProduct } from "@/lib/shopify-products";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro

/**
 * POST /api/shopify-products/update-template { ids }
 *
 * "Update Template" — Template đổi gì thì ĐẨY HẾT xuống listing đang chạy, mỗi listing tự khớp
 * template của nó (gán tay → Product type → ACTIVE duy nhất → duy nhất của store), KHÔNG phải chọn
 * 1 template từ dropdown như "Apply template" cũ.
 *
 * Ghi xuống Shopify (1 request productSet + 2 request phụ mỗi listing):
 *   • Product type / Vendor / Theme template
 *   • Category + category metafields (taxonomy)
 *   • Options + variants + price + compare-at + SKU
 *   • metafield fusion.delivery  → widget "Estimated delivery" trên trang sản phẩm
 *   • Kênh bán / publications (chỉ THÊM, không gỡ khỏi kênh khác)
 *
 * KHÔNG đụng: COLLECTIONS (mỗi listing xếp theo dịp/chủ đề riêng — đẩy collection của template vào là loạn).
 * KHÔNG đụng: title, description/3 tab do AI viết, ảnh, SEO, tags — đó là nội dung riêng từng listing.
 * KHÔNG đụng: trạng thái ACTIVE/DRAFT của listing (giữ nguyên status hiện tại, không lấy status template).
 *
 * ⚠ productSet dựng lại cấu trúc variants: variant nào không có trong template sẽ BỊ XOÁ và variant
 * mới sinh GID mới. Vì vậy client bắt buộc hỏi xác nhận trước khi chạy hàng loạt.
 *
 * Nặng (mỗi listing ~3-6s) → client chia lô 5, ở đây chặn 10 và có ngân sách thời gian.
 */
const MAX_IDS = 10;
const CONCURRENCY = 3;
const BUDGET_MS = 265_000;

type Tpl = typeof schema.shopifyTemplates.$inferSelect;

// Cùng luật khớp template với AI Optimize / Push delivery.
function tplFor(tpls: Tpl[], storeId: string, productType: string | null, pinnedId: string | null): Tpl | null {
  if (pinnedId) { const p = tpls.find((t) => t.id === pinnedId); if (p) return p; }
  const list = tpls.filter((t) => t.storeId === storeId);
  const pt = (productType ?? "").trim().toLowerCase();
  if (pt) { const m = list.find((t) => (t.productType ?? "").trim().toLowerCase() === pt); if (m) return m; }
  const active = list.filter((t) => t.status === "ACTIVE");
  if (active.length === 1) return active[0];
  if (list.length === 1) return list[0];
  return null;
}

// Chỉ ghi cặp số ĐẦY ĐỦ — thiếu 1 vế thì bỏ cả cặp, widget dùng số mặc định của nó
// còn hơn hiện ra khoảng ngày sai.
const pair = (min: number | null, max: number | null): [number, number] | null =>
  (min == null || max == null) ? null : [Math.min(min, max), Math.max(min, max)];

// Metafield fusion.delivery (json) từ các cột ship_* của template. Không có số nào → không ghi.
function deliveryMetafield(t: Tpl): { namespace: string; key: string; type: string; value: string }[] {
  const proc = pair(t.shipProcMin, t.shipProcMax);
  const us = pair(t.shipUsMin, t.shipUsMax);
  const intl = pair(t.shipIntlMin, t.shipIntlMax);
  if (!proc && !us && !intl) return [];
  const payload: Record<string, unknown> = {};
  if (proc) payload.proc = proc;
  if (us) payload.us = us;
  if (intl) payload.intl = intl;
  if (t.shipCutoffHour != null) payload.cutoff = t.shipCutoffHour;
  return [{ namespace: "fusion", key: "delivery", type: "json", value: JSON.stringify(payload) }];
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, MAX_IDS);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });

  const rows = await db.select({ p: schema.shopifyProducts, cred: schema.stores.apiCredentials, seller: schema.stores.sellerId, mk: schema.stores.marketplace })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const tpls = await db.select().from(schema.shopifyTemplates);
  const results: { id: string; title: string; ok: boolean; error?: string }[] = [];

  async function one(r: typeof rows[number]) {
    const p = r.p;
    const cred = (r.cred ?? {}) as ShopifyCred;
    if (r.mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
      results.push({ id: p.id, title: p.title, ok: false, error: "store chưa cấu hình Shopify API" }); return;
    }
    if (!p.shopifyProductId) {
      results.push({ id: p.id, title: p.title, ok: false, error: "listing chưa có Shopify product ID — Sync lại" }); return;
    }
    const t = tplFor(tpls, p.storeId, p.productType, p.templateId);
    if (!t) {
      results.push({ id: p.id, title: p.title, ok: false, error: `không khớp template nào (Product type "${p.productType ?? ""}")` }); return;
    }
    if (t.storeId !== p.storeId) {
      results.push({ id: p.id, title: p.title, ok: false, error: `template "${t.name}" thuộc store khác` }); return;
    }

    // title giữ nguyên, KHÔNG truyền descriptionHtml ⇒ productSet không đụng mô tả 3 tab do AI viết.
    const res = await applyTemplate(cred, t as unknown as Template, { id: p.shopifyProductId, title: p.title }, {
      includeImages: false,
      statusOverride: p.status,               // giữ ACTIVE/DRAFT hiện có của listing
      extraMetafields: deliveryMetafield(t),  // số ngày giao hàng cho widget
      skipCollections: true,                  // KHÔNG đụng collection — xếp theo dịp/chủ đề từng listing
    });
    if (!res.ok) { results.push({ id: p.id, title: p.title, ok: false, error: res.error }); return; }

    // Kéo bản mới về DB (variant GID mới, giá mới, collection mới…) để list không hiện số cũ.
    try {
      const fresh = await fetchOneShopifyProduct(cred, p.shopifyProductId);
      if (fresh) {
        await db.update(schema.shopifyProducts).set({
          handle: fresh.handle, title: fresh.title, bodyHtml: fresh.bodyHtml, vendor: fresh.vendor, productType: fresh.productType,
          tags: fresh.tags, status: fresh.status, seoTitle: fresh.seoTitle, seoDescription: fresh.seoDescription,
          category: fresh.category, collections: fresh.collections, options: fresh.options, variants: fresh.variants, images: fresh.images,
          onlineStoreUrl: fresh.onlineStoreUrl, totalInventory: fresh.totalInventory,
          templateId: t.id, dirty: false, syncedAt: new Date(), pushedAt: new Date(), updatedAt: new Date(),
        }).where(eq(schema.shopifyProducts.id, p.id));
      } else {
        await db.update(schema.shopifyProducts).set({ templateId: t.id, dirty: false, pushedAt: new Date(), updatedAt: new Date() }).where(eq(schema.shopifyProducts.id, p.id));
      }
    } catch { /* Shopify đã ghi xong; sync lỗi thì bấm Sync là có */ }

    // res.error dạng "partial: …" = productSet OK nhưng collection/kênh lỗi → vẫn tính thành công, có cảnh báo.
    results.push({ id: p.id, title: p.title, ok: true, ...(res.error ? { error: res.error } : {}) });
  }

  // Chạy song song CONCURRENCY con một, dừng nhận việc mới khi sắp hết giờ.
  const queue = rows.slice();
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const r = queue.shift();
      if (!r) return;
      if (Date.now() - started > BUDGET_MS) { results.push({ id: r.p.id, title: r.p.title, ok: false, error: "hết thời gian của request — chạy lại lô này" }); continue; }
      try { await one(r); }
      catch (e) { results.push({ id: r.p.id, title: r.p.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }); }
    }
  });
  await Promise.all(workers);

  const updated = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: updated > 0, updated, failed: results.length - updated, results });
}
