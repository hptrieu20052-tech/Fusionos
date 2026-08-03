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
 * POST /api/shopify-products/push-google-fields { ids, customProduct?, audience? }
 *
 * Ghi 2 field mà feed Google & YouTube cần, dưới dạng metafield — KHÔNG đụng
 * title/description/giá/ảnh/status ⇒ không kích hoạt duyệt lại listing.
 *
 * 1) mm-google-shopping.custom_product  (boolean, "true")
 *    → Google nhận identifier_exists = no. Bắt buộc với hàng tự sản xuất / print-on-demand
 *      vì không có GTIN/brand-MPN toàn cầu. Thiếu nó Google báo lỗi thiếu định danh.
 *      Đây là field DUY NHẤT app Google & YouTube còn đọc từ namespace cũ mm-google-shopping.
 *
 * 2) shopify.target-audience  (taxonomy attribute → list.metaobject_reference)
 *    → map sang age_group. Google chỉ nhận MỘT giá trị; listing đang để "Kids; Adults"
 *      nên Google hoặc bỏ luôn attribute hoặc tự chọn bừa một cái.
 *
 *    KHÔNG đoán GID: route đọc mảng metaobject GID ĐANG CÓ trên listing, hỏi Shopify handle
 *    của từng GID, rồi GIỮ LẠI đúng cái handle khớp `audience` và bỏ phần còn lại.
 *    Listing chưa có giá trị nào thì bỏ qua field này (báo "no audience value") — không bịa.
 *
 * metafieldsSet nhận tối đa 25 metafield/lần ⇒ 12 sản phẩm/lô (2 metafield mỗi con).
 */
const MAX_IDS = 250;
const CHUNK = 12;

const Q_PRODUCTS = `query fusionGfRead($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product { id metafield(namespace: "shopify", key: "target-audience") { value type } }
  }
}`;

const Q_METAOBJECTS = `query fusionGfMo($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Metaobject { id handle type } }
}`;

const M_SET = `mutation fusionGoogleFields($m: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } }
}`;

// Metafield list.metaobject_reference lưu JSON mảng GID. Trả [] nếu rỗng/hỏng.
function gidList(v: string | null | undefined): string[] {
  const s = String(v ?? "").trim();
  if (!s) return [];
  try {
    const a = JSON.parse(s);
    if (Array.isArray(a)) return a.map((x) => String(x)).filter((x) => x.startsWith("gid://"));
  } catch { /* không phải JSON */ }
  return s.startsWith("gid://") ? [s] : [];
}

// "Kids" / "kids-and-adults" → "kids" — so khớp handle metaobject không phân biệt hoa thường/gạch.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, MAX_IDS);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  const wantCustom = b?.customProduct !== false;                       // mặc định BẬT
  const audience = typeof b?.audience === "string" ? b.audience.trim() : "kids";
  const wantAudience = audience !== "";

  const rows = await db.select({
    id: schema.shopifyProducts.id, gid: schema.shopifyProducts.shopifyProductId, title: schema.shopifyProducts.title,
    storeId: schema.shopifyProducts.storeId,
    cred: schema.stores.apiCredentials, seller: schema.stores.sellerId, mk: schema.stores.marketplace,
  }).from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  if (!rows.length) return NextResponse.json({ ok: false, error: "không tìm thấy sản phẩm" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const results: { id: string; title: string; ok: boolean; note?: string; error?: string }[] = [];
  let audienceFixed = 0, audienceSkipped = 0;

  const byStore = new Map<string, typeof rows>();
  for (const r of rows) { const a = byStore.get(r.storeId) ?? []; a.push(r); byStore.set(r.storeId, a); }

  for (const group of Array.from(byStore.values())) {
    const cred = (group[0].cred ?? {}) as ShopifyCred;
    if (group[0].mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
      for (const r of group) results.push({ id: r.id, title: r.title, ok: false, error: "store chưa cấu hình Shopify API" });
      continue;
    }
    const live = group.filter((r) => {
      if (r.gid) return true;
      results.push({ id: r.id, title: r.title, ok: false, error: "listing chưa có Shopify product ID — Sync lại" });
      return false;
    });
    if (!live.length) continue;

    // ---- 1. Đọc target-audience hiện tại của từng listing ----
    const cur = new Map<string, { gids: string[]; type: string }>();
    if (wantAudience) {
      for (let i = 0; i < live.length; i += 50) {
        const slice = live.slice(i, i + 50);
        try {
          const d = await shopifyGraphQL<{ nodes?: ({ id?: string; metafield?: { value?: string; type?: string } | null } | null)[] }>(
            cred, Q_PRODUCTS, { ids: slice.map((r) => r.gid) });
          for (const n of d.nodes ?? []) {
            if (!n?.id) continue;
            cur.set(n.id, { gids: gidList(n.metafield?.value), type: String(n.metafield?.type ?? "list.metaobject_reference") });
          }
        } catch { /* đọc lỗi → coi như không có giá trị, sẽ bỏ qua field audience */ }
      }
    }

    // ---- 2. Hỏi handle của mọi metaobject GID gặp phải (1 lần cho cả lô) ----
    const handleOf = new Map<string, string>();
    const allGids = Array.from(new Set(Array.from(cur.values()).flatMap((c) => c.gids)));
    for (let i = 0; i < allGids.length; i += 100) {
      const slice = allGids.slice(i, i + 100);
      try {
        const d = await shopifyGraphQL<{ nodes?: ({ id?: string; handle?: string } | null)[] }>(cred, Q_METAOBJECTS, { ids: slice });
        for (const n of d.nodes ?? []) if (n?.id && n.handle) handleOf.set(n.id, String(n.handle));
      } catch { /* không đọc được handle → không lọc bừa, bỏ qua field audience */ }
    }

    // ---- 3. Dựng metafield cần ghi cho từng listing ----
    type MF = { ownerId: string; namespace: string; key: string; type: string; value: string };
    const jobs: { row: typeof live[number]; mfs: MF[]; note?: string }[] = [];
    for (const r of live) {
      const mfs: MF[] = [];
      let note: string | undefined;

      if (wantCustom) mfs.push({ ownerId: r.gid, namespace: "mm-google-shopping", key: "custom_product", type: "boolean", value: "true" });

      if (wantAudience) {
        const c = cur.get(r.gid);
        const keep = (c?.gids ?? []).filter((g) => norm(handleOf.get(g) ?? "") === norm(audience));
        if (!c || !c.gids.length) { note = "no target audience value on this listing — left untouched"; audienceSkipped++; }
        else if (!keep.length) { note = `no "${audience}" value among the current audience(s) — left untouched`; audienceSkipped++; }
        else if (keep.length === c.gids.length) { note = `audience already "${audience}" only`; }
        else { mfs.push({ ownerId: r.gid, namespace: "shopify", key: "target-audience", type: c.type || "list.metaobject_reference", value: JSON.stringify(keep) }); audienceFixed++; }
      }

      if (!mfs.length) { results.push({ id: r.id, title: r.title, ok: true, note: note ?? "nothing to write" }); continue; }
      jobs.push({ row: r, mfs, note });
    }

    // ---- 4. Ghi theo lô ----
    for (let i = 0; i < jobs.length; i += CHUNK) {
      const slice = jobs.slice(i, i + CHUNK);
      // Mảng phẳng + bảng tra index → listing, để map ngược userErrors về đúng sản phẩm.
      const flat: MF[] = [];
      const ownerOfIdx: number[] = [];
      slice.forEach((j, k) => j.mfs.forEach((m) => { flat.push(m); ownerOfIdx.push(k); }));
      try {
        const d = await shopifyGraphQL<{ metafieldsSet?: { userErrors?: { field?: string[]; message?: string }[] } }>(cred, M_SET, { m: flat });
        const errs = d.metafieldsSet?.userErrors ?? [];
        if (errs.length) {
          const msgByJob = new Map<number, string>();
          for (const e of errs) {
            const idx = Number((e.field ?? []).find((f) => /^\d+$/.test(String(f))) ?? -1);
            const k = idx >= 0 ? ownerOfIdx[idx] : -1;
            if (k >= 0) msgByJob.set(k, String(e.message ?? "lỗi"));
          }
          const generic = msgByJob.size ? "" : errs.map((e) => e.message).join("; ").slice(0, 200);
          slice.forEach((j, k) => {
            const m = msgByJob.get(k) ?? generic;
            results.push(m ? { id: j.row.id, title: j.row.title, ok: false, error: m } : { id: j.row.id, title: j.row.title, ok: true, note: j.note });
          });
        } else {
          for (const j of slice) results.push({ id: j.row.id, title: j.row.title, ok: true, note: j.note });
        }
      } catch (e) {
        const msg = String((e as Error)?.message ?? e).slice(0, 200);
        for (const j of slice) results.push({ id: j.row.id, title: j.row.title, ok: false, error: msg });
      }
    }
  }

  const pushed = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: pushed > 0, pushed, failed: results.length - pushed, audienceFixed, audienceSkipped, results });
}
