import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { titleKey } from "@/lib/title-key";
import { readTtCfg, ttGetProductDetail, ttGetValidCfg } from "@/lib/tiktok-shop";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * v405 · POST /api/shopbase-products/stage { source: "etsy"|"tiktok", ids: string[], storeId, templateId? }
 *
 * Đúng flow Etsy→Shopify (v172): "Push to ShopBase" ở Manage Products Etsy/TikTok chỉ STAGE
 * listing thành BẢN NHÁP trong Manage Products · ShopBase (shopbase_products, shopbase_product_id = '').
 * Hoàn thiện title/mô tả/ảnh/giá ở đó, bấm Push bên ĐÓ mới tạo thật trên ShopBase
 * (POST products.json) — xem shopbase-products/push/route.ts.
 *
 * Bản nháp mang theo:
 *   - title/mô tả/tags/ảnh theo listing nguồn (Etsy: shopifyTitle/shopifyDesc nếu có; TikTok: Get
 *     Product Detail để lấy description + full ảnh, lỗi API thì dùng dữ liệu search đã sync)
 *   - options + variants + giá: theo TEMPLATE ShopBase nếu chọn, không thì theo nguồn
 *   - template collections áp lúc Push, KHÔNG đụng ShopBase ở bước stage
 *   - etsy_product_id / tiktok_product_id → chống stage trùng; re-stage bản nháp = GHI ĐÈ;
 *     listing đã lên ShopBase thật rồi thì từ chối (sửa bên Manage Products · ShopBase)
 *   - CHỐNG TRÙNG MẪU: cùng titleKey đã có trong store đích → từ chối (mirror v180)
 */
type SbOption = { name: string; position: number; values: string[] };
type SbVariant = {
  id: string; title: string; selectedOptions: { name: string; value: string }[];
  price: string; compareAtPrice: string | null; sku: string; barcode: string; inventoryQty: number | null;
};
type SbImage = { id: string; src: string; altText: string; position: number };
type Tpl = typeof schema.shopbaseTemplates.$inferSelect;
type TplOption = { name: string; values: string[] };
type TplVariant = { options: Record<string, string>; price?: string; compareAtPrice?: string | null; sku?: string };

const CANON = /digital/i;
const strv = (v: unknown) => (v == null ? "" : String(v)).trim();

// Dựng options + variants từ TEMPLATE (cùng luật fromTemplate của push-shopify).
function fromTemplate(tpl: Tpl): { options: SbOption[]; variants: SbVariant[] } {
  const tOpts = (Array.isArray(tpl.options) ? tpl.options : []) as TplOption[];
  const tVars = (Array.isArray(tpl.variants) ? tpl.variants : []) as TplVariant[];
  const options: SbOption[] = tOpts.map((o, i) => ({ name: o.name, position: i + 1, values: (o.values ?? []).slice() }));
  const cartesian = (): Record<string, string>[] => tOpts.reduce<Record<string, string>[]>(
    (acc, opt) => acc.flatMap((c) => (opt.values ?? []).map((v) => ({ ...c, [opt.name]: v }))), [{}]);
  const key = (o: Record<string, string>) => Object.keys(o).sort().map((k) => `${k}=${o[k]}`).join("|");
  const priceMap = new Map(tVars.map((v) => [key(v.options ?? {}), v]));
  const combos = tVars.length ? tVars.map((v) => v.options ?? {}) : (tOpts.length ? cartesian() : [{}]);
  const variants: SbVariant[] = combos.slice(0, 500).map((opts) => {   // ShopBase: 500 variants/sản phẩm
    const hit = priceMap.get(key(opts));
    const sel = tOpts.map((o) => ({ name: o.name, value: opts[o.name] ?? "" })).filter((x) => x.value);
    return {
      id: "", title: sel.map((s) => s.value).join(" / ") || "Default Title", selectedOptions: sel,
      price: hit?.price && /^\d/.test(String(hit.price)) ? String(hit.price) : "0.00",
      compareAtPrice: hit?.compareAtPrice && /^\d/.test(String(hit.compareAtPrice)) ? String(hit.compareAtPrice) : null,
      sku: String(hit?.sku ?? ""), barcode: "", inventoryQty: null,
    };
  });
  return { options, variants };
}

// Dựng options + variants từ variations của listing Etsy (flow không template).
function fromEtsy(p: typeof schema.etsyProducts.$inferSelect): { options: SbOption[]; variants: SbVariant[] } {
  const vars = (Array.isArray(p.variations) ? p.variations as { name?: string; values?: string[] }[] : [])
    .map((v) => ({ name: strv(v.name), values: (v.values ?? []).map(String).filter((x) => x && !CANON.test(x)) }))
    .filter((v) => v.name && v.values.length)
    .slice(0, 3);
  const vp = (p.variantPrices && typeof p.variantPrices === "object" ? p.variantPrices : {}) as Record<string, string>;
  const basePrice = String(p.price ?? "0");
  const priceFor = (vals: string[]) => {
    for (const v of vals) { const x = vp[v]; if (x != null && String(x).trim() !== "") return String(x); }
    return basePrice;
  };
  const combos: string[][] = vars.length
    ? vars.reduce<string[][]>((acc, v) => acc.flatMap((c) => v.values.map((val) => [...c, val])), [[]])
    : [[]];
  const options: SbOption[] = vars.map((v, i) => ({ name: v.name, position: i + 1, values: v.values }));
  const variants: SbVariant[] = combos.slice(0, 500).map((vals) => ({
    id: "", title: vals.join(" / ") || "Default Title",
    selectedOptions: vars.map((v, i) => ({ name: v.name, value: vals[i] })),
    price: priceFor(vals), compareAtPrice: null,
    sku: String(p.sku ?? ""), barcode: "", inventoryQty: null,
  }));
  return { options, variants };
}

// v406 · Mô tả bản nháp: template có description ⇒ dùng NÓ thay mô tả nguồn (ShopBase không chạy
// AI Optimize, mô tả chuẩn sống trong template). Số ngày giao có ⇒ gắn vào CUỐI mô tả:
//   1. thẻ ẩn data-fusion-delivery='{json}' — widget shopbase-delivery-widget.html trên theme
//      ShopBase đọc ra, vẽ timeline Ordered/Shipped/Delivered với ngày ĐỘNG theo từng nước;
//   2. khối text tĩnh class "fusion-delivery-fallback" — hiện khi theme CHƯA cài widget
//      (widget cài rồi sẽ tự ẩn khối này đi).
function buildBody(tpl: Tpl | null, sourceHtml: string): string {
  let body = sourceHtml;
  const td = strv(tpl?.description);
  if (td) body = /<[a-z][\s\S]*>/i.test(td) ? td : td.replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
  if (!tpl) return body;

  const pair = (a: number | null | undefined, b: number | null | undefined): [number, number] | null =>
    a == null && b == null ? null : [a ?? (b as number), b ?? (a as number)];
  const proc = pair(tpl.shipProcMin, tpl.shipProcMax);
  const us = pair(tpl.shipUsMin, tpl.shipUsMax);
  const intl = pair(tpl.shipIntlMin, tpl.shipIntlMax);
  if (!proc && !us && !intl) return body;

  const countries = (tpl.shipCountries && typeof tpl.shipCountries === "object" ? tpl.shipCountries : {}) as Record<string, [number, number]>;
  const cfg: Record<string, unknown> = {};
  if (proc) cfg.proc = proc;
  if (us) cfg.us = us;
  if (intl) cfg.intl = intl;
  if (tpl.shipCutoffHour != null) cfg.cutoff = tpl.shipCutoffHour;
  if (Object.keys(countries).length) cfg.countries = countries;
  const json = JSON.stringify(cfg).replace(/'/g, "&#39;");

  const lines: string[] = [];
  if (proc) lines.push(`Processing time: ${proc[0]}\u2013${proc[1]} business days`);
  if (us) lines.push(`United States shipping: ${us[0]}\u2013${us[1]} business days`);
  if (intl) lines.push(`International shipping: ${intl[0]}\u2013${intl[1]} business days`);

  body += `${body ? "<br><br>" : ""}` +
    `<div class="fusion-delivery" data-fusion-delivery='${json}' style="display:none"></div>` +
    `<p class="fusion-delivery-fallback"><strong>\u{1F69A} Estimated delivery</strong><br>${lines.join("<br>")}</p>`;
  return body;
}

// v407 · Customize (buyer inputs) của template ⇒ thẻ ẩn data-fusion-customize trong mô tả.
// Widget shopbase-customize-widget.html trên theme đọc ra, render ô Color/tên khắc... phía trên
// nút Add to cart; giá trị khách chọn đi vào line item properties của đơn ShopBase.
function appendCustomize(tpl: Tpl | null, body: string): string {
  const pqs = (Array.isArray(tpl?.personalization) ? tpl!.personalization : []) as { type?: string; label?: string; required?: boolean; options?: string[]; maxChars?: number }[];
  const clean = pqs.map((q) => ({
    type: q?.type === "dropdown" ? "dropdown" : "text",
    label: strv(q?.label).slice(0, 45),
    required: !!q?.required,
    options: (Array.isArray(q?.options) ? q.options : []).map((s) => strv(s)).filter(Boolean).slice(0, 50),
    maxChars: Math.min(Math.max(Math.round(Number(q?.maxChars) || 0) || 100, 1), 1024),
  })).filter((q) => q.label && (q.type === "text" || q.options.length));
  if (!clean.length) return body;
  const json = JSON.stringify(clean).replace(/'/g, "&#39;");
  return body + `<div class="fusion-customize" data-fusion-customize='${json}' style="display:none"></div>`;
}

// Ảnh từ raw TikTok: main_images[].urls[0] (search + detail cùng shape).
function tiktokImages(raw: Record<string, unknown> | null): string[] {
  const imgs = (Array.isArray(raw?.main_images) ? raw!.main_images : []) as { urls?: string[]; thumb_urls?: string[] }[];
  return imgs.map((im) => strv(im?.urls?.[0]) || strv(im?.thumb_urls?.[0])).filter(Boolean);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const source = String(b?.source ?? "") as "etsy" | "tiktok";
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 100);
  const storeId = String(b?.storeId ?? "").trim();
  const templateId = /^[0-9a-f-]{36}$/i.test(String(b?.templateId ?? "")) ? String(b.templateId) : "";
  if (!["etsy", "tiktok"].includes(source) || !ids.length || !storeId) {
    return NextResponse.json({ ok: false, error: "source + ids + storeId required" }, { status: 400 });
  }

  // Store ShopBase đích — stage không gọi API ShopBase nên không cần credentials, chỉ cần đúng store.
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store || store.marketplace !== "shopbase") return NextResponse.json({ ok: false, error: "target store is not ShopBase" }, { status: 400 });

  // Scope: seller chỉ stage từ listing của mình VÀ tới store của mình.
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!store.sellerId || !scopeIds.includes(store.sellerId))) {
    return NextResponse.json({ ok: false, error: "forbidden: target store not in your scope" }, { status: 403 });
  }

  // Template (tuỳ chọn) — options/variants/giá của bản nháp theo template; collections áp lúc Push.
  let tpl: Tpl | null = null;
  if (templateId) {
    const [t] = await db.select().from(schema.shopbaseTemplates).where(eq(schema.shopbaseTemplates.id, templateId)).limit(1);
    if (!t) return NextResponse.json({ ok: false, error: "template not found" }, { status: 404 });
    if (t.storeId !== storeId) return NextResponse.json({ ok: false, error: "template belongs to another store — pick a template of the target store" }, { status: 400 });
    tpl = t;
  }

  // CHỐNG TRÙNG MẪU trong store đích (mirror v180): cùng titleKey → từ chối, trừ chính bản nháp của listing này.
  const catalog = await db.select({
    title: schema.shopbaseProducts.title, handle: schema.shopbaseProducts.handle,
    etsyId: schema.shopbaseProducts.etsyProductId, ttId: schema.shopbaseProducts.tiktokProductId,
  }).from(schema.shopbaseProducts).where(eq(schema.shopbaseProducts.storeId, storeId));
  const byTitleKey = new Map<string, { handle: string | null; srcId: string | null }>();
  for (const c of catalog) {
    const k = titleKey(c.title);
    if (k && !byTitleKey.has(k)) byTitleKey.set(k, { handle: c.handle, srcId: (source === "etsy" ? c.etsyId : c.ttId) ?? null });
  }

  const results: { id: string; title: string; ok: boolean; error?: string }[] = [];
  let staged = 0;

  // ── Nguồn ETSY ─────────────────────────────────────────────────────────
  if (source === "etsy") {
    const rows = await db.select({ p: schema.etsyProducts, storeSeller: schema.stores.sellerId })
      .from(schema.etsyProducts)
      .leftJoin(schema.stores, eq(schema.stores.id, schema.etsyProducts.storeId))
      .where(inArray(schema.etsyProducts.id, ids));
    if (scopeIds && rows.some((r) => !r.storeSeller || !scopeIds.includes(r.storeSeller))) {
      return NextResponse.json({ ok: false, error: "forbidden: some listings are not in your stores" }, { status: 403 });
    }
    for (const { p } of rows) {
      const title = p.shopifyTitle || p.title;
      try {
        const dup = byTitleKey.get(titleKey(title));
        if (dup && dup.srcId !== p.id) {
          results.push({ id: p.id, title, ok: false, error: `duplicate design — already in this store as "${dup.handle ?? "?"}". Not staged.` });
          continue;
        }
        const built = tpl ? fromTemplate(tpl) : fromEtsy(p);
        const images: SbImage[] = (Array.isArray(p.images) ? p.images as string[] : [])
          .filter(Boolean).slice(0, 12)
          .map((src, i) => ({ id: "", src: String(src), altText: "", position: i + 1 }));
        const draft = {
          storeId,
          title,
          bodyHtml: appendCustomize(tpl, buildBody(tpl, (p.shopifyDesc || p.description || "").replace(/\r\n/g, "\n").replace(/\n/g, "<br>"))),
          vendor: (tpl?.vendor ?? "").trim() || store.name,
          productType: (tpl?.productType ?? "").trim() || "Personalized",
          tags: (p.shopifyTags || p.tags || "").split(",").map((t) => t.trim().replace(/_/g, " ")).filter(Boolean).slice(0, 250).join(", "),
          status: "DRAFT",
          options: built.options, variants: built.variants, images,
          templateId: templateId || null,
          etsyProductId: p.id, tiktokProductId: null,
          dirty: true, updatedAt: new Date(),
        };
        const [cur] = await db.select({ id: schema.shopbaseProducts.id, pid: schema.shopbaseProducts.shopbaseProductId })
          .from(schema.shopbaseProducts)
          .where(and(eq(schema.shopbaseProducts.etsyProductId, p.id), eq(schema.shopbaseProducts.storeId, storeId)))
          .limit(1);
        if (cur) {
          if (cur.pid) { results.push({ id: p.id, title, ok: false, error: "already on ShopBase — edit it in Manage Products · ShopBase" }); continue; }
          await db.update(schema.shopbaseProducts).set(draft).where(eq(schema.shopbaseProducts.id, cur.id));
        } else {
          await db.insert(schema.shopbaseProducts).values({ ...draft, shopbaseProductId: "" });
        }
        staged++;
        results.push({ id: p.id, title, ok: true });
      } catch (e) {
        results.push({ id: p.id, title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }
  }

  // ── Nguồn TIKTOK ───────────────────────────────────────────────────────
  if (source === "tiktok") {
    const rows = await db.select({ p: schema.tiktokProducts, storeSeller: schema.stores.sellerId, srcCred: schema.stores.apiCredentials })
      .from(schema.tiktokProducts)
      .leftJoin(schema.stores, eq(schema.stores.id, schema.tiktokProducts.storeId))
      .where(inArray(schema.tiktokProducts.id, ids));
    if (scopeIds && rows.some((r) => !r.storeSeller || !scopeIds.includes(r.storeSeller))) {
      return NextResponse.json({ ok: false, error: "forbidden: some listings are not in your stores" }, { status: 403 });
    }
    // Cache cfg TikTok theo store nguồn — Get Product Detail lấy description + full ảnh.
    const cfgCache = new Map<string, Awaited<ReturnType<typeof ttGetValidCfg>> | null>();
    const getCfg = async (srcStoreId: string, cred: unknown) => {
      if (cfgCache.has(srcStoreId)) return cfgCache.get(srcStoreId) ?? null;
      let cfg: Awaited<ReturnType<typeof ttGetValidCfg>> | null = null;
      try {
        if (readTtCfg((cred ?? null) as Record<string, string> | null).refreshToken) {
          cfg = await ttGetValidCfg(srcStoreId, (cred ?? null) as Record<string, string> | null);
        }
      } catch { cfg = null; }
      cfgCache.set(srcStoreId, cfg);
      return cfg;
    };
    for (const { p, srcCred } of rows) {
      const title = strv(p.title) || `TikTok #${p.tiktokProductId}`;
      try {
        const dup = byTitleKey.get(titleKey(title));
        if (dup && dup.srcId !== p.id) {
          results.push({ id: p.id, title, ok: false, error: `duplicate design — already in this store as "${dup.handle ?? "?"}". Not staged.` });
          continue;
        }
        // Detail để lấy description + full ảnh; lỗi API → dùng raw đã sync (search không có description).
        let raw = (p.raw && typeof p.raw === "object" ? p.raw : null) as Record<string, unknown> | null;
        let description = strv(raw?.description);
        const cfg = await getCfg(p.storeId, srcCred);
        if (cfg) {
          try {
            const detail = await ttGetProductDetail(cfg, p.tiktokProductId);
            if (detail && typeof detail === "object") { raw = detail; description = strv(detail.description) || description; }
          } catch { /* dùng raw sync */ }
        }
        const imgUrls = tiktokImages(raw);
        const built = tpl ? fromTemplate(tpl) : {
          options: [] as SbOption[],
          variants: [{ id: "", title: "Default Title", selectedOptions: [], price: String(p.priceMin ?? "0.00"), compareAtPrice: null, sku: strv(p.sellerSku), barcode: "", inventoryQty: null }] as SbVariant[],
        };
        const images: SbImage[] = imgUrls.slice(0, 12).map((src, i) => ({ id: "", src, altText: "", position: i + 1 }));
        const draft = {
          storeId,
          title,
          bodyHtml: appendCustomize(tpl, buildBody(tpl, description)),   // TikTok trả description dạng HTML sẵn
          vendor: (tpl?.vendor ?? "").trim() || store.name,
          productType: (tpl?.productType ?? "").trim() || "Personalized",
          tags: "",
          status: "DRAFT",
          options: built.options, variants: built.variants, images,
          templateId: templateId || null,
          etsyProductId: null, tiktokProductId: p.id,
          dirty: true, updatedAt: new Date(),
        };
        const [cur] = await db.select({ id: schema.shopbaseProducts.id, pid: schema.shopbaseProducts.shopbaseProductId })
          .from(schema.shopbaseProducts)
          .where(and(eq(schema.shopbaseProducts.tiktokProductId, p.id), eq(schema.shopbaseProducts.storeId, storeId)))
          .limit(1);
        if (cur) {
          if (cur.pid) { results.push({ id: p.id, title, ok: false, error: "already on ShopBase — edit it in Manage Products · ShopBase" }); continue; }
          await db.update(schema.shopbaseProducts).set(draft).where(eq(schema.shopbaseProducts.id, cur.id));
        } else {
          await db.insert(schema.shopbaseProducts).values({ ...draft, shopbaseProductId: "" });
        }
        staged++;
        results.push({ id: p.id, title, ok: true });
      } catch (e) {
        results.push({ id: p.id, title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }
  }

  return NextResponse.json({ ok: staged > 0, created: staged, failed: results.length - staged, store: store.name, results });
}
