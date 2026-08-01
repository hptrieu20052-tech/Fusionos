import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopHost, shopifyGraphQL, type ShopifyCred } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/shopify-products/push-delivery { ids }
 *
 * Đẩy SỐ NGÀY GIAO HÀNG của Template (theo Product type) lên từng listing Shopify,
 * dưới dạng metafield  fusion.delivery  (type json):
 *   { "proc": [1,3], "us": [4,8], "intl": [10,30], "cutoff": 14 }
 *
 * Widget "Estimated delivery" dán trong theme đọc metafield này bằng Liquid
 * (product.metafields.fusion.delivery) rồi tự tính ngày thực tế trong trình duyệt khách.
 * ⇒ Sửa số trong FUSION → bấm Push delivery → cả trăm listing đổi timeline, KHÔNG phải sửa theme.
 *
 * KHÁC với "Push to Shopify": route này CHỈ ghi metafield, không đụng title/description/giá/ảnh,
 * nên chạy được cả trên listing đang sạch (dirty = false) mà không sợ ghi đè nội dung.
 *
 * metafieldsSet nhận tối đa 25 metafield/lần → gom theo lô 25, mỗi store 1 request.
 */
const MAX_IDS = 250;
const CHUNK = 25;

const M_SET = `mutation fusionDelivery($m: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } }
}`;

type Tpl = typeof schema.shopifyTemplates.$inferSelect;

// Cùng luật khớp template với AI Optimize: gán tay → khớp Product type → ACTIVE duy nhất → duy nhất của store.
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

// Chỉ ghi cặp số ĐẦY ĐỦ. Thiếu 1 vế (min có, max trống) thì bỏ qua cả cặp — widget tự dùng mặc định,
// còn hơn hiện ra khoảng ngày sai.
const pair = (min: number | null, max: number | null): [number, number] | null =>
  (min == null || max == null) ? null : [Math.min(min, max), Math.max(min, max)];

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, MAX_IDS);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });

  const rows = await db.select({
    id: schema.shopifyProducts.id, gid: schema.shopifyProducts.shopifyProductId, title: schema.shopifyProducts.title,
    storeId: schema.shopifyProducts.storeId, productType: schema.shopifyProducts.productType, templateId: schema.shopifyProducts.templateId,
    cred: schema.stores.apiCredentials, seller: schema.stores.sellerId, mk: schema.stores.marketplace,
  }).from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const tpls = await db.select().from(schema.shopifyTemplates);

  const results: { id: string; title: string; ok: boolean; error?: string }[] = [];
  // Gom theo store — mỗi store 1 bộ credential, và metafieldsSet ghi được nhiều product/lần.
  const byStore = new Map<string, typeof rows>();
  for (const r of rows) { const a = byStore.get(r.storeId) ?? []; a.push(r); byStore.set(r.storeId, a); }

  for (const group of Array.from(byStore.values())) {
    const cred = (group[0].cred ?? {}) as ShopifyCred;
    if (group[0].mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
      for (const r of group) results.push({ id: r.id, title: r.title, ok: false, error: "store chưa cấu hình Shopify API" });
      continue;
    }

    // Dựng payload từng listing; loại sớm những con không có template / template chưa điền số.
    const jobs: { row: typeof group[number]; value: string }[] = [];
    for (const r of group) {
      if (!r.gid) { results.push({ id: r.id, title: r.title, ok: false, error: "listing chưa có Shopify product ID — Sync lại" }); continue; }
      const t = tplFor(tpls, r.storeId, r.productType, r.templateId);
      if (!t) { results.push({ id: r.id, title: r.title, ok: false, error: `không khớp template nào (Product type "${r.productType ?? ""}")` }); continue; }
      const proc = pair(t.shipProcMin, t.shipProcMax);
      const us = pair(t.shipUsMin, t.shipUsMax);
      const intl = pair(t.shipIntlMin, t.shipIntlMax);
      if (!proc && !us && !intl) { results.push({ id: r.id, title: r.title, ok: false, error: `template "${t.name}" chưa điền số ngày giao hàng` }); continue; }
      const payload: Record<string, unknown> = {};
      if (proc) payload.proc = proc;
      if (us) payload.us = us;
      if (intl) payload.intl = intl;
      if (t.shipCutoffHour != null) payload.cutoff = t.shipCutoffHour;
      jobs.push({ row: r, value: JSON.stringify(payload) });
    }

    for (let i = 0; i < jobs.length; i += CHUNK) {
      const slice = jobs.slice(i, i + CHUNK);
      try {
        const data = await shopifyGraphQL<{ metafieldsSet?: { userErrors?: { field?: string[]; message?: string }[] } }>(cred, M_SET, {
          m: slice.map((j) => ({ ownerId: j.row.gid, namespace: "fusion", key: "delivery", type: "json", value: j.value })),
        });
        const errs = data.metafieldsSet?.userErrors ?? [];
        if (errs.length) {
          // userErrors trỏ theo index trong mảng metafields — map ngược về đúng listing để báo lỗi cụ thể.
          const msgByIdx = new Map<number, string>();
          for (const e of errs) {
            const idx = Number((e.field ?? []).find((f) => /^\d+$/.test(String(f))) ?? -1);
            if (idx >= 0) msgByIdx.set(idx, String(e.message ?? "lỗi"));
          }
          const generic = msgByIdx.size ? "" : errs.map((e) => e.message).join("; ").slice(0, 200);
          slice.forEach((j, k) => {
            const m = msgByIdx.get(k) ?? generic;
            results.push(m ? { id: j.row.id, title: j.row.title, ok: false, error: m } : { id: j.row.id, title: j.row.title, ok: true });
          });
        } else {
          for (const j of slice) results.push({ id: j.row.id, title: j.row.title, ok: true });
        }
      } catch (e) {
        const msg = String((e as Error)?.message ?? e).slice(0, 200);
        for (const j of slice) results.push({ id: j.row.id, title: j.row.title, ok: false, error: msg });
      }
    }
  }

  const pushed = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: pushed > 0, pushed, failed: results.length - pushed, results });
}
