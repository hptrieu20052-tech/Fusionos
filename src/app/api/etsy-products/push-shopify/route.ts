import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { payloadOf } from "@/lib/personalization";
import { shopHost, shopifyGraphQL, type ShopifyCred } from "@/lib/shopify";
import type { Template } from "@/lib/shopify-template";
import type { SyncedImage, SyncedOption, SyncedVariant } from "@/lib/shopify-products";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/etsy-products/push-shopify { ids: string[], storeId: string, templateId? }
 *
 * v172 · FLOW MỚI — KHÔNG tạo thẳng trên Shopify nữa.
 * Nút "Push to Shopify" bên Manage Products · Etsy giờ chỉ STAGE listing thành BẢN NHÁP
 * trong Manage Products · Shopify (bảng shopify_products, shopify_product_id = '').
 * Hoàn thiện title/mô tả/ảnh/giá/Custom options ở đó xong, bấm Push bên ĐÓ mới tạo thật
 * trên Shopify (productSet) — xem shopify-products/push/route.ts.
 *
 * Bản nháp mang theo:
 *   - title (shopifyTitle||title), mô tả, tags, vendor = tên store, status DRAFT, dirty = true
 *   - options + variants + giá: theo TEMPLATE nếu chọn, không thì theo variations của Etsy
 *   - ảnh Etsy CDN (chưa có media GID — Push sẽ upload)
 *   - Custom options của seller (v171) → personalization của bản nháp
 *   - etsy_product_id → chống stage trùng; Push xong ghi ngược shopify_product_id về listing Etsy
 *
 * Đẩy lại listing đã stage (chưa Push) = GHI ĐÈ bản nháp. Listing đã lên Shopify thật rồi thì
 * từ chối — sửa tiếp bên Manage Products · Shopify, đừng stage lại đè lên listing đang chạy.
 */
const CANON = /digital/i;

// v172 · Listing đang giữ GID cũ: hỏi Shopify xem sản phẩm còn sống không. Còn → không cho stage đè
// (sửa bên Manage Products · Shopify). Đã bị XOÁ bên Shopify → gỡ liên kết cũ và cho stage lại.
const PRODUCT_ALIVE = `query Alive($id: ID!) { product(id: $id) { id } }`;
async function productAlive(cred: ShopifyCred, gid: string): Promise<boolean | null> {
  try {
    const d = await shopifyGraphQL<{ product?: { id: string } | null }>(cred, PRODUCT_ALIVE, { id: gid });
    return !!d.product?.id;
  } catch { return null; } // không hỏi được thì KHÔNG đoán — giữ nguyên liên kết
}

// Dựng options + variants cho bản nháp từ TEMPLATE (cùng luật với applyTemplate: combos theo
// tpl.variants, thiếu thì cartesian; giá/sku theo tổ hợp).
function fromTemplate(tpl: Template): { options: SyncedOption[]; variants: SyncedVariant[] } {
  const options: SyncedOption[] = tpl.options.map((o, i) => ({ name: o.name, position: i + 1, values: o.values.slice() }));
  const cartesian = (): Record<string, string>[] => tpl.options.reduce<Record<string, string>[]>(
    (acc, opt) => acc.flatMap((c) => opt.values.map((v) => ({ ...c, [opt.name]: v }))), [{}]);
  const key = (o: Record<string, string>) => Object.keys(o).sort().map((k) => `${k}=${o[k]}`).join("|");
  const priceMap = new Map(tpl.variants.map((v) => [key(v.options), v]));
  const combos = tpl.variants.length ? tpl.variants.map((v) => v.options) : (tpl.options.length ? cartesian() : [{}]);
  const variants: SyncedVariant[] = combos.slice(0, 100).map((opts) => {
    const hit = priceMap.get(key(opts));
    const sel = tpl.options.map((o) => ({ name: o.name, value: opts[o.name] ?? "" })).filter((x) => x.value);
    return {
      id: "", title: sel.map((s) => s.value).join(" / ") || "Default Title", selectedOptions: sel,
      price: hit?.price && /^\d/.test(String(hit.price)) ? String(hit.price) : "0.00",
      compareAtPrice: null, sku: String(hit?.sku ?? ""), barcode: "", inventoryItemId: null, inventoryQty: null,
    };
  });
  return { options, variants };
}

// Dựng options + variants từ variations của chính listing Etsy (flow không template).
function fromEtsy(p: typeof schema.etsyProducts.$inferSelect): { options: SyncedOption[]; variants: SyncedVariant[] } {
  const vars = (Array.isArray(p.variations) ? p.variations as { name?: string; values?: string[] }[] : [])
    .map((v) => ({ name: String(v.name ?? "").trim(), values: (v.values ?? []).map(String).filter((x) => x && !CANON.test(x)) }))
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
  const options: SyncedOption[] = vars.map((v, i) => ({ name: v.name, position: i + 1, values: v.values }));
  const variants: SyncedVariant[] = combos.slice(0, 100).map((vals) => ({
    id: "", title: vals.join(" / ") || "Default Title",
    selectedOptions: vars.map((v, i) => ({ name: v.name, value: vals[i] })),
    price: priceFor(vals), compareAtPrice: null,
    sku: String(p.sku ?? ""), barcode: "", inventoryItemId: null, inventoryQty: null,
  }));
  return { options, variants };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 100);
  const storeId = String(b?.storeId ?? "").trim();
  const templateId = /^[0-9a-f-]{36}$/i.test(String(b?.templateId ?? "")) ? String(b.templateId) : "";
  if (!ids.length || !storeId) return NextResponse.json({ ok: false, error: "ids + storeId required" }, { status: 400 });

  // Store Shopify đích — stage không gọi API nên không cần credentials, chỉ cần đúng store.
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store || store.marketplace !== "shopify") return NextResponse.json({ ok: false, error: "target store is not Shopify" }, { status: 400 });

  // Scope: seller chỉ stage từ listing của mình VÀ tới store của mình
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!store.sellerId || !scopeIds.includes(store.sellerId))) {
    return NextResponse.json({ ok: false, error: "forbidden: target store not in your scope" }, { status: 403 });
  }

  const rows = await db.select({ p: schema.etsyProducts, storeSeller: schema.stores.sellerId })
    .from(schema.etsyProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.etsyProducts.storeId))
    .where(inArray(schema.etsyProducts.id, ids));
  if (scopeIds && rows.some((r) => !r.storeSeller || !scopeIds.includes(r.storeSeller))) {
    return NextResponse.json({ ok: false, error: "forbidden: some listings are not in your stores" }, { status: 403 });
  }

  // Template (tuỳ chọn) — cấu trúc options/variants/giá của bản nháp lấy theo template.
  // Category / collections / sales channels của template áp sau bằng các nút sẵn có bên
  // Manage Products · Shopify (Push template fields / Apply template) — stage không đụng Shopify.
  let tpl: Template | null = null;
  if (templateId) {
    const [t] = await db.select().from(schema.shopifyTemplates).where(eq(schema.shopifyTemplates.id, templateId)).limit(1);
    if (!t) return NextResponse.json({ ok: false, error: "template not found" }, { status: 404 });
    if (t.storeId !== storeId) return NextResponse.json({ ok: false, error: "template thuộc store khác — chọn template của đúng store đích" }, { status: 400 });
    tpl = t as unknown as Template;
  }

  // Credentials chỉ cần khi phải kiểm tra GID cũ còn sống không (listing từng lên Shopify).
  const cred = (store.apiCredentials ?? {}) as ShopifyCred;
  const canVerify = !!shopHost(cred) && !!(cred.adminToken || (cred.clientId && cred.clientSecret));

  const results: { id: string; title: string; ok: boolean; error?: string }[] = [];
  let staged = 0;
  for (const { p } of rows) {
    const title = p.shopifyTitle || p.title;
    try {
      // Listing đang giữ GID (flow cũ hoặc đã Push xong): còn sống → sửa bên Manage Products · Shopify;
      // đã bị xoá bên Shopify → gỡ liên kết cũ rồi stage lại như listing mới.
      const oldGid = (p as { shopifyProductId?: string }).shopifyProductId || "";
      if (oldGid) {
        const alive = canVerify ? await productAlive(cred, oldGid) : null;
        if (alive !== false) {
          results.push({ id: p.id, title, ok: false, error: alive === null ? "cannot verify old Shopify link — check store API credentials" : "already on Shopify — edit it in Manage Products · Shopify" });
          continue;
        }
        await db.update(schema.etsyProducts).set({ shopifyProductId: null, updatedAt: new Date() }).where(eq(schema.etsyProducts.id, p.id));
        // Bản ghi cũ bên Manage Products · Shopify còn trỏ vào GID chết → gỡ GID để nó thành bản nháp
        // (được ghi đè ngay bên dưới), khỏi để rác trỏ vào sản phẩm không tồn tại.
        await db.update(schema.shopifyProducts).set({ shopifyProductId: "", etsyProductId: p.id, updatedAt: new Date() })
          .where(and(eq(schema.shopifyProducts.storeId, storeId), eq(schema.shopifyProducts.shopifyProductId, oldGid)));
      }

      const built = tpl ? fromTemplate(tpl) : fromEtsy(p);
      const images: SyncedImage[] = (Array.isArray(p.images) ? p.images as string[] : [])
        .filter(Boolean).slice(0, 12)
        .map((src, i) => ({ id: "", src: String(src), altText: "", position: i + 1 }));
      const persFields = payloadOf((p as { personalization?: unknown }).personalization);

      const draft = {
        storeId,
        title,
        bodyHtml: (p.shopifyDesc || p.description || "").replace(/\r\n/g, "\n").replace(/\n/g, "<br>"),
        vendor: store.name,
        productType: (tpl?.productType ?? "").trim() || "Personalized",
        tags: (p.shopifyTags || p.tags || "").split(",").map((t) => t.trim().replace(/_/g, " ")).filter(Boolean).slice(0, 250).join(", "),
        status: "DRAFT",
        options: built.options,
        variants: built.variants,
        images,
        personalization: persFields.length ? persFields : null,
        templateId: templateId || null,
        etsyProductId: p.id,
        dirty: true,
        updatedAt: new Date(),
      };

      // Chống stage trùng: đã có bản nháp của đúng listing này ở đúng store → GHI ĐÈ bản nháp.
      const [cur] = await db.select({ id: schema.shopifyProducts.id, gid: schema.shopifyProducts.shopifyProductId })
        .from(schema.shopifyProducts)
        .where(and(eq(schema.shopifyProducts.etsyProductId, p.id), eq(schema.shopifyProducts.storeId, storeId)))
        .limit(1);
      if (cur) {
        if (cur.gid) {
          results.push({ id: p.id, title, ok: false, error: "already on Shopify — edit it in Manage Products · Shopify" });
          continue;
        }
        await db.update(schema.shopifyProducts).set(draft).where(eq(schema.shopifyProducts.id, cur.id));
      } else {
        await db.insert(schema.shopifyProducts).values({ ...draft, shopifyProductId: "" });
      }
      staged++;
      results.push({ id: p.id, title, ok: true });
    } catch (e) {
      results.push({ id: p.id, title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }

  return NextResponse.json({ ok: staged > 0, created: staged, failed: results.length - staged, store: store.name, results });
}
