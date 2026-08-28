import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray, isNotNull, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { getSpConfig, spConfigured, patchListingItem, putListingItem, deleteListingItem, getListing, getListingData, MK_US, vText, sleep, type PatchOp } from "@/lib/amazon-sp-api";
import { sanitizeTitle } from "@/lib/amazon-title";
import { amzImageUrl } from "@/lib/amazon-image";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/amazon-products/push-listing { ids, storeId? }
 *
 * ⬆ Push to Amazon qua Listings Items API (KHÔNG dùng Feeds — flat-file feed bị Amazon chặn 403):
 *   • Listing ĐÃ có ASIN  → PATCH cập nhật title/bullets/description/giá theo SKU.
 *   • Listing CHƯA có ASIN → PUT tạo mới, CLONE cấu trúc attributes từ 1 listing đã live cùng loại
 *     (dùng đúng JSON Amazon đã chấp nhận), chỉ thay title/bullets/desc/ảnh/giá/SKU.
 * LUÔN trả JSON.
 */
const mk = MK_US;

type Variation = { suffix: string; label: string; price: string };
type Variant = { sku?: string | null };
type Img = { src?: string; position?: number };
type Attrs = Record<string, unknown>;

function rootSku(variants: unknown, manual: string | null): string {
  const arr = (Array.isArray(variants) ? variants : []) as Variant[];
  for (const v of arr) {
    const s = String(v?.sku ?? "").trim();
    if (!s) continue;
    const parts = s.split("-").filter(Boolean);
    return parts.length >= 2 ? parts.slice(0, 2).join("-") : s;
  }
  return manual ?? "";
}
function imgList(override: unknown, source: unknown): string[] {
  const ov = (Array.isArray(override) ? override : []).map((x) => String(x ?? "").trim()).filter((s) => /^https:\/\//i.test(s));
  if (ov.length) return ov.slice(0, 9).map(amzImageUrl);
  const arr = (Array.isArray(source) ? source : []) as Img[];
  return arr.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99)).map((i) => String(i?.src ?? "").trim()).filter((s) => /^https:\/\//i.test(s)).slice(0, 9).map(amzImageUrl);
}
const plain = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const bulletsVal = (bl: string[]) => bl.slice(0, 5).map((v) => ({ value: v, marketplace_id: mk, language_tag: "en_US" }));
const imageVal = (url: string) => [{ media_location: url, marketplace_id: mk }];

/** Field an toàn BẮT BUỘC cho listing mới (sách: không pin, không hàng nguy hiểm, POD miễn GTIN). */
const safetyAttrs = (): Attrs => ({
  batteries_required: [{ value: false, marketplace_id: mk }],
  supplier_declared_dg_hz_regulation: [{ value: "not_applicable", marketplace_id: mk }],
  // POD không có mã vạch → khai miễn GTIN (thay cho External Product ID)
  supplier_declared_has_product_identifier_exemption: [{ value: true, marketplace_id: mk }],
});

/** Clone attributes tham chiếu + strip định danh + gán override + đảm bảo field an toàn. */
function cloneAttrs(base: Attrs, overrides: Attrs): Attrs {
  const o: Attrs = JSON.parse(JSON.stringify(base || {}));
  // Strip định danh + NGÀY RELEASE (clone từ mẫu kéo theo offering_release_date tương lai → giữ offer chưa mở bán "Missing offer").
  for (const k of [
    "externally_assigned_product_identifier", "merchant_suggested_asin",
    "offering_release_date", "merchant_release_date", "release_date", "product_site_launch_date",
  ]) delete o[k];
  const sa = safetyAttrs();
  for (const [k, v] of Object.entries(sa)) if (o[k] === undefined) o[k] = v; // chỉ thêm nếu clone chưa có
  for (const [k, v] of Object.entries(overrides)) o[k] = v;
  return o;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const b = await req.json().catch(() => null);
    const storeId = typeof b?.storeId === "string" && /^[0-9a-f-]{36}$/i.test(b.storeId) ? b.storeId : undefined;
    const ids: string[] = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x)));
    if (!ids.length) return NextResponse.json({ ok: false, error: "No listings selected" }, { status: 200 });

    const cfg = await getSpConfig(storeId);
    if (!spConfigured(cfg)) return NextResponse.json({ ok: false, error: "SP-API not configured — open the Amazon store in Stores." }, { status: 200 });

    const rows = await db.select({
      a: schema.amazonProducts,
      srcVariants: schema.shopifyProducts.variants, srcType: schema.shopifyProducts.productType, srcImages: schema.shopifyProducts.images,
      seller: schema.stores.sellerId,
    }).from(schema.amazonProducts)
      .leftJoin(schema.shopifyProducts, eq(schema.shopifyProducts.id, schema.amazonProducts.shopifyProductId))
      .leftJoin(schema.stores, eq(schema.stores.id, schema.amazonProducts.storeId))
      .where(inArray(schema.amazonProducts.id, ids));
    const scopeIds = await storeOwnerScopeIds(session);
    if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const tpls = await db.select().from(schema.amazonTemplates);
    const tplObjFor = (amazonTemplateId: string | null, typeHint: string | null) => {
      let t = amazonTemplateId ? tpls.find((x) => x.id === amazonTemplateId) : undefined;
      if (!t) { const pt = (typeHint ?? "").trim().toLowerCase(); if (pt) t = tpls.find((x) => (x.productType ?? "").trim().toLowerCase() === pt); }
      if (!t && tpls.length === 1) t = tpls[0];
      return t;
    };
    const varsFor = (amazonTemplateId: string | null, typeHint: string | null, override: unknown): Variation[] => {
      const ov = (Array.isArray(override) ? override : []) as Variation[];
      if (ov.length) return ov.filter((v) => v.suffix);
      const t = tplObjFor(amazonTemplateId, typeHint);
      return ((t?.config as { variations?: Variation[] } | null)?.variations ?? []).filter((v) => v.suffix);
    };
    // v326 · Amazon product type ĐỘNG theo template (constants.amazonProductType) — hỗ trợ nhiều loại (puzzle…)
    const ptOf = (amazonTemplateId: string | null, typeHint: string | null): string => {
      const c = (tplObjFor(amazonTemplateId, typeHint)?.config as { constants?: { amazonProductType?: string } } | null)?.constants;
      return (c?.amazonProductType || "").trim() || "DISPLAY_ALBUM";
    };
    // v329 · Shipping Template + Handling Time lấy từ template constants → đẩy vào offer.
    const shipOf = (amazonTemplateId: string | null, typeHint: string | null): { group: string; handling: number } => {
      const c = (tplObjFor(amazonTemplateId, typeHint)?.config as { constants?: { shippingTemplate?: string; leadTimeDays?: string } } | null)?.constants;
      const handling = parseInt(String(c?.leadTimeDays ?? "").trim(), 10);
      return { group: (c?.shippingTemplate || "").trim(), handling: isNaN(handling) || handling < 0 ? 0 : handling };
    };
    // v365 · Quantity lấy TỪ TEMPLATE (constants.quantity). POD = làm theo đơn nên không bao giờ hết →
    // mặc định 999 (KHÔNG để 100/rơi 0). Trước đây hard-code 100 khiến push có lúc để listing về out-of-stock.
    const qtyOf = (amazonTemplateId: string | null, typeHint: string | null): number => {
      const c = (tplObjFor(amazonTemplateId, typeHint)?.config as { constants?: { quantity?: string | number } } | null)?.constants;
      const q = parseInt(String(c?.quantity ?? "").trim(), 10);
      return isNaN(q) || q <= 0 ? 999 : q;
    };
    // fulfillment_availability đầy đủ (kèm handling time nếu có). quantity lấy từ template (mặc định 999).
    const fulfillVal = (handling: number, quantity: number) => [{ fulfillment_channel_code: "DEFAULT", quantity, ...(handling > 0 ? { lead_time_to_ship_max_days: handling } : {}) }];

    // v366 · Listing constants (brand, manufacturer, item type, color, xuất xứ…) lấy TỪ TEMPLATE cho CẢ push,
    // giống flat file → đổi template là push cũng đổi theo, không lệ thuộc giá trị cũ của reference clone.
    const constOf = (amazonTemplateId: string | null, typeHint: string | null): Record<string, string> =>
      ((tplObjFor(amazonTemplateId, typeHint)?.config as { constants?: Record<string, string> } | null)?.constants) ?? {};
    // template-key → tên attribute SP-API khả dĩ (chọn cái NÀO CÓ trong reference để không đặt sai tên).
    const CONST_ATTRS: [string, string[]][] = [
      ["brand", ["brand", "brand_name"]],
      ["manufacturer", ["manufacturer"]],
      ["itemTypeKeyword", ["item_type_keyword", "item_type_name"]],
      ["color", ["color", "color_name"]],
      ["colorMap", ["color_map"]],
      ["countryOfOrigin", ["country_of_origin"]],
      ["numberOfItems", ["number_of_items"]],
      ["numberOfBoxes", ["number_of_boxes"]],
      ["includedComponents", ["included_components", "included_components1"]],
      ["cpsiaWarning", ["cpsia_cautionary_statement"]],
    ];
    // Sinh object ghi đè: chỉ đụng attribute ĐÃ CÓ trong reference (an toàn — tên chắc chắn hợp lệ cho product type đó).
    const constOverrides = (consts: Record<string, string>, refAttrs: Attrs | null): Attrs => {
      const out: Attrs = {};
      if (!refAttrs) return out;
      for (const [k, cands] of CONST_ATTRS) {
        const val = String(consts?.[k] ?? "").trim();
        if (!val) continue;
        const name = cands.find((n) => n in refAttrs);
        if (!name) continue;
        out[name] = [{ value: val, marketplace_id: mk }];
      }
      return out;
    };
    // Shipping template KHÔNG set qua API: create tự kế thừa từ clone, update giữ nguyên → tránh lẫn TÊN (flat file) ↔ ID (API).

    let updated = 0, created = 0;
    const skipped: string[] = [];
    const issues: string[] = [];
    const asinSync: { id: string; asin: string | null }[] = []; // đồng bộ ASIN DB ↔ thực tế Amazon
    // v339 · Con của family mới được HOÃN: tạo hết parent trước → chờ CHUNG 1 lần → tạo hết con (push nhiều listing 1 lần).
    const pendingChildren: { root: string; pt: string; parentSku: string; vars: Variation[]; refChild: Attrs; build: (rc: Attrs | null, v: Variation, ps: string) => Attrs | null }[] = [];
    const deadline = Date.now() + 52_000;

    // Trả true nếu Amazon KHÔNG báo lỗi (ERROR). Gom message lỗi để hiện cho user.
    const ok = (rr: { sku: string; status?: string; issues?: { message?: string; code?: string; severity?: string }[] }) => {
      const errs = (rr.issues ?? []).filter((i) => (i.severity ?? "").toUpperCase() === "ERROR");
      errs.slice(0, 2).forEach((e) => { if (issues.length < 8) issues.push(`${rr.sku}: ${e.message ?? e.code ?? "invalid"}`); });
      return errs.length === 0;
    };

    // ── Reference clone cho việc TẠO MỚI: chọn 1 listing đã live CÙNG PRODUCT TYPE làm mẫu, cache theo type ──
    const refCache = new Map<string, { parent: Attrs | null; child: Attrs | null }>();
    const getReference = async (pt: string): Promise<{ parent: Attrs | null; child: Attrs | null }> => {
      if (refCache.has(pt)) return refCache.get(pt)!;
      const cands = await db.select({ a: schema.amazonProducts, v: schema.shopifyProducts.variants, srcType: schema.shopifyProducts.productType })
        .from(schema.amazonProducts).leftJoin(schema.shopifyProducts, eq(schema.shopifyProducts.id, schema.amazonProducts.shopifyProductId))
        .where(isNotNull(schema.amazonProducts.asin));
      let result: { parent: Attrs | null; child: Attrs | null } = { parent: null, child: null };
      for (const c of cands) {
        if (ptOf(c.a.amazonTemplateId, c.srcType || c.a.manualType) !== pt) continue;
        const refRoot = rootSku(c.v, c.a.manualSku);
        const refVars = varsFor(c.a.amazonTemplateId, c.srcType || c.a.manualType, c.a.variations);
        if (!refRoot || !refVars.length) continue;
        const p = await getListingData(cfg!, `${refRoot}-PARENT-AMZ`, "attributes").catch(() => null);
        const ch = await getListingData(cfg!, `${refRoot}-${refVars[0].suffix}`, "attributes").catch(() => null);
        if (p?.attributes && ch?.attributes) { result = { parent: p.attributes, child: ch.attributes }; break; }
      }
      refCache.set(pt, result);
      return result;
    };

    for (const r of rows) {
      if (Date.now() > deadline) { skipped.push("timed out — run again to continue"); break; }
      const title = sanitizeTitle((r.a.title ?? "").trim()); // lọc cụm cấm (code 100473) trước khi đẩy
      const bullets = ((r.a.bullets as string[] | null) ?? []).filter(Boolean);
      const desc = plain(r.a.description);
      const root = rootSku(r.srcVariants, r.a.manualSku);
      const vars = varsFor(r.a.amazonTemplateId, r.srcType || r.a.manualType, r.a.variations);
      const imgs = imgList(r.a.images, r.srcImages);
      const pt = ptOf(r.a.amazonTemplateId, r.srcType || r.a.manualType); // product type động theo template
      const ship = shipOf(r.a.amazonTemplateId, r.srcType || r.a.manualType); // shipping template + handling time
      const qty = qtyOf(r.a.amazonTemplateId, r.srcType || r.a.manualType); // v365 · tồn kho từ template (mặc định 999)
      const consts = constOf(r.a.amazonTemplateId, r.srcType || r.a.manualType); // v366 · constants từ template

      if (!root || !title) { skipped.push(`${title || r.a.id}: missing SKU/title`); continue; }
      if (!vars.length) { skipped.push(`${title}: missing variations`); continue; }

      const commonPatch: PatchOp[] = [{ op: "replace", path: "/attributes/product_description", value: vText(desc, mk) }];
      if (bullets.length) commonPatch.push({ op: "replace", path: "/attributes/bullet_point", value: bulletsVal(bullets) });

      const otherImgs: Attrs = {};
      imgs.slice(1, 9).forEach((u, i) => { otherImgs[`other_product_image_locator_${i + 1}`] = imageVal(u); });
      // v354 · size_name DUY NHẤT trong family (chống mã 8801 — Amazon loại child thứ 2 nếu trùng size_name
      // với child đã gắn parent). Nếu label bị trùng/để trống giống nhau thì tự thêm hậu tố suffix. Y như bên flat file.
      const sizeNameMap = new Map<string, string>();
      {
        const used = new Set<string>();
        for (const v of vars) {
          let s = String(v.label || v.suffix || "").trim().slice(0, 50) || String(v.suffix);
          if (used.has(s.toLowerCase())) {
            s = `${s} (${v.suffix})`.slice(0, 50);
            let n = 2;
            while (used.has(s.toLowerCase())) { s = `${String(v.label || v.suffix)} (${v.suffix}-${n})`.slice(0, 50); n++; }
          }
          used.add(s.toLowerCase());
          sizeNameMap.set(v.suffix, s);
        }
      }
      const sizeNameOf = (v: Variation) => sizeNameMap.get(v.suffix) ?? String(v.label || v.suffix);

      // v338 · Build attributes cho 1 CON (dùng chung cả create mới lẫn tạo-lại con thiếu ở update).
      const buildChildAttrs = (refChild: Attrs | null, v: Variation, parentSku: string): Attrs | null => {
        if (!refChild) return null;
        const price = Number(v.price);
        const sizeName = sizeNameOf(v);
        const rel = JSON.parse(JSON.stringify(refChild.child_parent_sku_relationship ?? [{ marketplace_id: mk }]));
        if (Array.isArray(rel) && rel[0]) { rel[0].parent_sku = parentSku; rel[0].child_relationship_type = rel[0].child_relationship_type ?? "variation"; }
        return cloneAttrs(refChild, {
          item_name: vText(`${title} (${sizeName})`.slice(0, 200), mk),
          product_description: vText(desc, mk),
          bullet_point: bulletsVal(bullets),
          size_name: [{ value: sizeName, marketplace_id: mk }],
          ...(imgs[0] ? { main_product_image_locator: imageVal(imgs[0]) } : {}),
          child_parent_sku_relationship: rel,
          condition_type: [{ value: "new_new", marketplace_id: mk }],
          fulfillment_availability: fulfillVal(ship.handling, qty),
          ...constOverrides(consts, refChild), // v366 · brand/manufacturer/item type… từ template
          ...otherImgs,
          ...(!isNaN(price) && price > 0 ? {
            list_price: [{ value: price, currency: "USD", marketplace_id: mk }],
            purchasable_offer: [{ marketplace_id: mk, currency: "USD", our_price: [{ schedule: [{ value_with_tax: price }] }] }],
          } : {}),
        });
      };

      // v327 · Quyết định UPDATE/CREATE theo TRẠNG THÁI THẬT trên Amazon, KHÔNG dựa vào ASIN đã lưu
      // (đã xóa bên Seller Central nhưng DB còn ASIN → phải Create; hoặc còn sống mà DB trống ASIN → Update).
      const parentSku0 = `${root}-PARENT-AMZ`;
      let existsOnAmazon = !!r.a.asin; // fallback nếu không kiểm tra được (lỗi mạng)
      try {
        const live = await getListing(cfg!, parentSku0);
        // v335 · CHỈ coi là "đã tồn tại để UPDATE" khi có ASIN. Nếu tồn tại nhưng CHƯA có ASIN
        // (tạo dở → "Missing Information") thì đi nhánh CREATE để PUT lại ĐẦY ĐỦ thuộc tính (GTIN exemption…),
        // vì PATCH không gửi đủ field bắt buộc nên không vá được listing dở.
        existsOnAmazon = !!(live && live.asin);
        const realAsin = live?.asin ?? null;
        if (realAsin !== (r.a.asin ?? null)) asinSync.push({ id: r.a.id, asin: realAsin });
      } catch { /* giữ fallback theo ASIN đã lưu */ }
      await sleep(200);

      if (existsOnAmazon) {
        // ── UPDATE (PATCH) ──
        // v366 · reference (cùng product type) để biết tên attribute hợp lệ → patch constants từ template.
        const uref = await getReference(pt);
        const constPatch = (attrs: Attrs | null): PatchOp[] =>
          Object.entries(constOverrides(consts, attrs)).map(([name, value]) => ({ op: "replace" as const, path: `/attributes/${name}`, value }));
        try {
          // v350 · cập nhật ảnh (main + phụ) trên cả parent
          const parentPatch: PatchOp[] = [{ op: "replace", path: "/attributes/item_name", value: vText(title, mk) }, ...commonPatch, ...constPatch(uref.parent)];
          if (imgs[0]) parentPatch.push({ op: "replace", path: "/attributes/main_product_image_locator", value: imageVal(imgs[0]) });
          imgs.slice(1, 9).forEach((u, i) => parentPatch.push({ op: "replace", path: `/attributes/other_product_image_locator_${i + 1}`, value: imageVal(u) }));
          const rr = await patchListingItem(cfg!, `${root}-PARENT-AMZ`, pt, parentPatch);
          if (ok(rr)) updated++;
        } catch (e) { if (issues.length < 8) issues.push(String((e as Error)?.message ?? e).slice(0, 140)); }
        await sleep(300);
        // v352 · đọc danh sách con ĐANG trong family để phát hiện con MỒ CÔI (tồn tại nhưng không thuộc family).
        const famData = await getListingData(cfg!, `${root}-PARENT-AMZ`, "relationships").catch(() => null);
        const familyChildSkus = new Set(((famData?.relationships as { childSkus?: string[] }[] | undefined) ?? []).flatMap((x) => x?.childSkus ?? []));
        await sleep(200);
        for (const v of vars) {
          if (Date.now() > deadline) break;
          const childSku = `${root}-${v.suffix}`;
          // v338 · Con thiếu (đã xóa để gỡ mồ côi) → PUT-create lại thành child sạch dưới parent đang sống → gom vào family.
          const childLive = await getListing(cfg!, childSku).catch(() => null);
          if (!childLive) {
            const ref2 = await getReference(pt);
            const ca = buildChildAttrs(ref2.child, v, `${root}-PARENT-AMZ`);
            if (ca) { try { const rr = await putListingItem(cfg!, childSku, pt, ca); if (ok(rr)) created++; } catch (e) { if (issues.length < 8) issues.push(String((e as Error)?.message ?? e).slice(0, 140)); } }
            else skipped.push(`${childSku}: missing on Amazon, no reference to recreate`);
            await sleep(400);
            continue;
          }
          // v352 · Con TỒN TẠI nhưng KHÔNG nằm trong family (mồ côi) → xóa để lần Push kế tạo lại vào family.
          if (familyChildSkus.size && !familyChildSkus.has(childSku)) {
            await deleteListingItem(cfg!, childSku).catch(() => {});
            skipped.push(`${childSku}: orphaned (standalone) → deleted. Push again in ~5 min to rebuild it into the family.`);
            await sleep(400);
            continue;
          }
          const price = Number(v.price);
          const sizeName = sizeNameOf(v);
          const cp: PatchOp[] = [{ op: "replace", path: "/attributes/item_name", value: vText(`${title} (${sizeName})`.slice(0, 200), mk) }, ...commonPatch];
          // v354 · patch cả size_name về giá trị duy nhất → lần push sau tự sửa child đang bị trùng (mã 8801).
          cp.push({ op: "replace", path: "/attributes/size_name", value: [{ value: sizeName, marketplace_id: mk }] });
          if (imgs[0]) cp.push({ op: "replace", path: "/attributes/main_product_image_locator", value: imageVal(imgs[0]) });
          // v350 · cập nhật CẢ ảnh phụ (gallery) khi push lại, không chỉ main
          imgs.slice(1, 9).forEach((u, i) => cp.push({ op: "replace", path: `/attributes/other_product_image_locator_${i + 1}`, value: imageVal(u) }));
          // Đảm bảo offer đầy đủ (condition + tồn kho) để gỡ "Missing offer"
          cp.push({ op: "replace", path: "/attributes/condition_type", value: [{ value: "new_new", marketplace_id: mk }] });
          cp.push({ op: "replace", path: "/attributes/fulfillment_availability", value: fulfillVal(ship.handling, qty) });
          cp.push(...constPatch(uref.child)); // v366 · brand/manufacturer/item type… từ template lên từng child
          if (!isNaN(price) && price > 0) {
            cp.push({ op: "replace", path: "/attributes/list_price", value: [{ value: price, currency: "USD", marketplace_id: mk }] });
            cp.push({ op: "replace", path: "/attributes/purchasable_offer", value: [{ marketplace_id: mk, currency: "USD", our_price: [{ schedule: [{ value_with_tax: price }] }] }] });
          }
          try { const rr = await patchListingItem(cfg!, `${root}-${v.suffix}`, pt, cp); if (ok(rr)) updated++; }
          catch (e) { if (issues.length < 8) issues.push(String((e as Error)?.message ?? e).slice(0, 140)); }
          await sleep(300);
        }
      } else {
        // ── CREATE (PUT, clone từ reference) ──
        const ref = await getReference(pt);
        if (!ref.parent || !ref.child) { skipped.push(`${title}: no live reference of product type "${pt}" to clone — create the first "${pt}" listing via "flat file" first, then later ones create via Push`); continue; }
        if (!imgs.length) { skipped.push(`${title}: missing image (white-background main)`); continue; }
        const parentSku = `${root}-PARENT-AMZ`;
        // PARENT
        try {
          const pa = cloneAttrs(ref.parent, {
            item_name: vText(title, mk),
            product_description: vText(desc, mk),
            bullet_point: bulletsVal(bullets),
            main_product_image_locator: imageVal(imgs[0]),
            ...constOverrides(consts, ref.parent), // v366 · constants từ template lên parent
            ...otherImgs,
          });
          const rr = await putListingItem(cfg!, parentSku, pt, pa);
          // parent nhiễm parentage_level sai (code 8603) → Amazon bắt XÓA rồi tạo lại. Tự xóa để lần push sau tạo sạch.
          if ((rr.issues ?? []).some((i) => String(i.code) === "8603")) {
            await deleteListingItem(cfg!, parentSku).catch(() => {});
            skipped.push(`${title}: parent SKU had a stuck parentage_level → deleted it. Wait ~5 min then Push again to rebuild the variation family.`);
            continue;
          }
          if (!ok(rr)) { continue; } // parent lỗi → bỏ qua children (đã gom message trong ok())
          created++;
          // v339 · HOÃN tạo con → gom lại, tạo sau khi TẤT CẢ parent đã tạo + chờ CHUNG 1 lần (đỡ chờ 12s/listing).
          pendingChildren.push({ root, pt, parentSku, vars, refChild: ref.child as Attrs, build: buildChildAttrs });
        } catch (e) { if (issues.length < 8) issues.push(String((e as Error)?.message ?? e).slice(0, 160)); continue; }
      }
    }

    // ── Tạo CON cho family mới: chờ parent đăng ký, rồi tạo THEO VÒNG size (tất cả size#1 của mọi listing →
    //    chờ 5s → size#2 …) để 2 con CÙNG listing cách nhau nhiều giây → Amazon kịp dựng family, con thứ 2
    //    KHÔNG bị mồ côi (race sibling). ──
    if (pendingChildren.length) {
      const waitMs = Math.min(12000, Math.max(0, deadline - Date.now() - 10000));
      if (waitMs > 0) await sleep(waitMs);
      const maxVars = Math.max(1, ...pendingChildren.map((pc) => pc.vars.length));
      for (let vi = 0; vi < maxVars; vi++) {
        if (Date.now() > deadline) { skipped.push("timed out creating children — Push again to finish the remaining size"); break; }
        if (vi > 0) await sleep(5000); // để vòng trước kịp vào family trước khi thêm sibling
        for (const pc of pendingChildren) {
          if (Date.now() > deadline) break;
          const v = pc.vars[vi];
          if (!v) continue;
          const ca = pc.build(pc.refChild, v, pc.parentSku);
          if (!ca) continue;
          try { const rr = await putListingItem(cfg!, `${pc.root}-${v.suffix}`, pc.pt, ca); if (ok(rr)) created++; }
          catch (e) { if (issues.length < 8) issues.push(String((e as Error)?.message ?? e).slice(0, 160)); }
          await sleep(300);
        }
      }
    }

    const touched = rows.map((r) => r.a.id);
    if (touched.length) await db.update(schema.amazonProducts).set({ status: "EXPORTED", exportedAt: new Date(), updatedAt: new Date() }).where(inArray(schema.amazonProducts.id, touched)).catch(() => {});
    // Đồng bộ ASIN DB theo thực tế Amazon (đã xóa → null; mới thấy → gán) để lần Push sau quyết định đúng.
    for (const s of asinSync) {
      await db.update(schema.amazonProducts).set({ asin: s.asin, updatedAt: new Date() }).where(eq(schema.amazonProducts.id, s.id)).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      updated, created,
      skipped, issues,
      summary: `Updated ${updated} SKU(s) · created ${created} SKU(s)${skipped.length ? ` · ${skipped.length} skipped` : ""}${issues.length ? ` · ${issues.length} error(s): ${issues.slice(0, 2).join(" | ")}` : ""}.`,
    });
  } catch (e) {
    console.error("push-listing fatal", e);
    return NextResponse.json({ ok: false, error: "Server error during push: " + String((e as Error)?.message ?? e).slice(0, 220) }, { status: 200 });
  }
}
