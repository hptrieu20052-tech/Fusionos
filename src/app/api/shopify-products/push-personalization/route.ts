import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopHost, shopifyGraphQL, type ShopifyCred } from "@/lib/shopify";
import { payloadOf } from "@/lib/personalization";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/shopify-products/push-personalization { ids }
 *
 * Đẩy bộ ô cá nhân hoá của Template lên từng listing Shopify, dưới dạng metafield
 *   fusion.options  (type json):
 *   [
 *     { "type":"dropdown", "label":"Front Cover Style", "required":true, "options":["Girl-themed","Boy-themed"] },
 *     { "type":"text", "label":"Personalization", "instructions":"Name on the cover", "required":true, "maxChars":20 },
 *     { "type":"upload", "label":"Upload your photo", "required":true, "maxFiles":3, "options":["Front","Inside","Back"] }
 *   ]
 *
 * Snippet Liquid  fusion-personalization  đọc metafield này rồi render ra ô nhập ngay trong form
 * Add to cart, mỗi ô là 1 line item property → đơn về Shopify có sẵn tên bé / lời đề tặng / ảnh khách gửi.
 * lib/shopify.ts (splitProperties) đã đọc sẵn properties → màn Orders hiện y như đơn Etsy, không phải sửa gì thêm.
 *
 * Sửa ô trong Template → bấm Push personalization → cả trăm listing đổi theo, KHÔNG phải sửa từng cái.
 * Muốn mỗi nhóm sản phẩm 1 bộ ô khác nhau: tạo nhiều template rồi gán bằng "Set AI template…".
 *
 * Giống push-delivery: CHỈ ghi metafield, không đụng title/description/giá/ảnh ⇒ chạy được cả trên
 * listing đang sạch (dirty = false) mà không sợ ghi đè nội dung.
 *
 * Template KHÔNG khai ô nào ⇒ ghi metafield rỗng "[]" để XOÁ ô cũ trên listing (bỏ ô cũng phải đẩy được),
 * chứ không bỏ qua im lặng.
 *
 * metafieldsSet nhận tối đa 25 metafield/lần → gom theo lô 25, mỗi store 1 request.
 */
const MAX_IDS = 250;
const CHUNK = 25;

const M_SET = `mutation fusionOptions($m: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } }
}`;

type Tpl = typeof schema.shopifyTemplates.$inferSelect;

// Cùng luật khớp template với AI Optimize / push-delivery:
// gán tay → khớp Product type → ACTIVE duy nhất → duy nhất của store.
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

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, MAX_IDS);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });

  const rows = await db.select({
    id: schema.shopifyProducts.id, gid: schema.shopifyProducts.shopifyProductId, title: schema.shopifyProducts.title,
    storeId: schema.shopifyProducts.storeId, productType: schema.shopifyProducts.productType, templateId: schema.shopifyProducts.templateId,
    pers: schema.shopifyProducts.personalization,
    cred: schema.stores.apiCredentials, seller: schema.stores.sellerId, mk: schema.stores.marketplace,
  }).from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const tpls = await db.select().from(schema.shopifyTemplates);

  const results: { id: string; title: string; ok: boolean; error?: string }[] = [];
  let cleared = 0;   // số listing bị xoá ô (template không khai câu nào) — báo lại để khỏi tưởng đã đẩy được ô
  const byStore = new Map<string, typeof rows>();
  for (const r of rows) { const a = byStore.get(r.storeId) ?? []; a.push(r); byStore.set(r.storeId, a); }

  for (const group of Array.from(byStore.values())) {
    const cred = (group[0].cred ?? {}) as ShopifyCred;
    if (group[0].mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
      for (const r of group) results.push({ id: r.id, title: r.title, ok: false, error: "store chưa cấu hình Shopify API" });
      continue;
    }

    const jobs: { row: typeof group[number]; value: string }[] = [];
    for (const r of group) {
      if (!r.gid) { results.push({ id: r.id, title: r.title, ok: false, error: "listing chưa có Shopify product ID — Sync lại" }); continue; }
      // v141: listing có bộ RIÊNG (Custom options) thì bộ đó thắng — bấm Push template fields
      // cũng không ghi đè. Chỉ listing chưa đặt riêng (NULL) mới lấy theo template.
      let fields;
      if (Array.isArray(r.pers)) {
        fields = payloadOf(r.pers);
      } else {
        const t = tplFor(tpls, r.storeId, r.productType, r.templateId);
        if (!t) { results.push({ id: r.id, title: r.title, ok: false, error: `chưa đặt Custom options riêng và không khớp template nào (Product type "${r.productType ?? ""}")` }); continue; }
        fields = payloadOf(t.personalization);
      }
      if (!fields.length) cleared++;
      jobs.push({ row: r, value: JSON.stringify(fields) });
    }

    for (let i = 0; i < jobs.length; i += CHUNK) {
      const slice = jobs.slice(i, i + CHUNK);
      try {
        const data = await shopifyGraphQL<{ metafieldsSet?: { userErrors?: { field?: string[]; message?: string }[] } }>(cred, M_SET, {
          m: slice.map((j) => ({ ownerId: j.row.gid, namespace: "fusion", key: "options", type: "json", value: j.value })),
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
  return NextResponse.json({ ok: pushed > 0, pushed, cleared, failed: results.length - pushed, results });
}
