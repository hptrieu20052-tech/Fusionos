import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopbaseApi, shopbaseConfigured, shopbaseHost, type ShopBaseCred } from "@/lib/shopbase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * v405 · POST /api/shopbase-products/push { ids: string[] }
 * TẠO sản phẩm thật trên ShopBase từ BẢN NHÁP đã stage (shopbase_product_id = '') —
 * bước 2 của flow Etsy/TikTok → ShopBase (bước 1 = stage/route.ts).
 *   - POST products.json (published=false → lên dạng nháp bên ShopBase, seller bật bán sau)
 *   - Template có collections → POST collects.json từng collection
 *   - Ghi ngược id/handle/variants/images chuẩn từ ShopBase; dirty=false, pushed_at=now
 * Bản ghi đã có shopbase_product_id (đang sống trên ShopBase) → bỏ qua (sửa qua Edit modal, PATCH tự đẩy).
 */
type Vari = { title?: string; price?: string; compareAtPrice?: string | null; sku?: string; selectedOptions?: { name: string; value: string }[] };
type Img = { src?: string; position?: number };
const strv = (v: unknown) => (v == null ? "" : String(v)).trim();

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 50);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });

  const rows = await db.select({
    p: schema.shopbaseProducts, sellerId: schema.stores.sellerId,
    marketplace: schema.stores.marketplace, cred: schema.stores.apiCredentials, storeName: schema.stores.name,
  }).from(schema.shopbaseProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopbaseProducts.storeId))
    .where(inArray(schema.shopbaseProducts.id, ids));

  const scopeIds = await storeOwnerScopeIds(session);
  const allowed = rows.filter((r) => r.marketplace === "shopbase" && (!scopeIds || !r.sellerId || scopeIds.includes(r.sellerId))); // sellerId NULL = store chung
  if (!allowed.length) return NextResponse.json({ ok: false, error: "no valid products" }, { status: 400 });

  // Cache template theo id — lấy collections để áp sau khi tạo.
  const tplIds = Array.from(new Set(allowed.map((r) => r.p.templateId).filter(Boolean))) as string[];
  const tpls = tplIds.length ? await db.select().from(schema.shopbaseTemplates).where(inArray(schema.shopbaseTemplates.id, tplIds)) : [];
  const tplById = new Map(tpls.map((t) => [t.id, t]));

  const results: { id: string; title: string; ok: boolean; error?: string }[] = [];
  let created = 0;

  for (const r of allowed) {
    const p = r.p;
    if (p.shopbaseProductId) { results.push({ id: p.id, title: p.title, ok: false, error: "already on ShopBase — edit it in Manage Products · ShopBase" }); continue; }
    const cred = ((r.cred ?? {}) as Record<string, unknown>).shopbase as ShopBaseCred | undefined;
    if (!shopbaseConfigured(cred ?? null)) { results.push({ id: p.id, title: p.title, ok: false, error: "store API is not configured — add Subdomain + API key + Password in Stores" }); continue; }

    try {
      const opts = ((Array.isArray(p.options) ? p.options : []) as { name?: string; values?: string[] }[])
        .map((o) => ({ name: strv(o?.name), values: (Array.isArray(o?.values) ? o.values : []).map(String).filter(Boolean) }))
        .filter((o) => o.name && o.values.length);
      const vars = ((Array.isArray(p.variants) ? p.variants : []) as Vari[]);
      const imgs = ((Array.isArray(p.images) ? p.images : []) as Img[]).filter((im) => strv(im?.src));

      const product: Record<string, unknown> = {
        title: p.title,
        body_html: p.bodyHtml ?? "",
        vendor: p.vendor ?? r.storeName ?? "",
        product_type: p.productType ?? "",
        tags: p.tags ?? "",
        published: false,   // lên dạng nháp — seller review rồi Make available sau
        variants: (vars.length ? vars : [{ title: "Default Title", price: "0.00", sku: "" }]).map((v) => {
          const so = (v.selectedOptions ?? []) as { name: string; value: string }[];
          const base: Record<string, unknown> = { price: v.price ?? "0.00", compare_at_price: v.compareAtPrice || null, sku: v.sku ?? "" };
          if (opts.length) { base.option1 = so[0]?.value; base.option2 = so[1]?.value; base.option3 = so[2]?.value; }
          return base;
        }),
        images: imgs.map((im, i) => ({ src: im.src, position: im.position ?? i + 1 })),
      };
      if (opts.length) product.options = opts.map((o) => ({ name: o.name }));

      const resp = await shopbaseApi(cred!, "products.json", { method: "POST", body: JSON.stringify({ product }) });
      const rp = (resp?.product ?? null) as Record<string, unknown> | null;
      const pid = strv(rp?.id);
      if (!pid) throw new Error("ShopBase did not return a product id");
      const handle = strv(rp?.handle);
      const host = shopbaseHost(cred!);

      // Đồng bộ lại id variant/ảnh chuẩn từ response.
      let finalVars = vars, finalImgs = imgs as { id?: string; src?: string; altText?: string; position?: number }[];
      if (rp) {
        if (Array.isArray(rp.variants)) finalVars = (rp.variants as Record<string, unknown>[]).map((v) => {
          const so: { name: string; value: string }[] = [];
          [v.option1, v.option2, v.option3].forEach((val, k) => { if (val != null && opts[k]) so.push({ name: opts[k].name, value: String(val) }); });
          return {
            id: strv(v.id), title: strv(v.title), price: strv(v.price),
            compareAtPrice: v.compare_at_price != null ? String(v.compare_at_price) : null, sku: strv(v.sku),
            barcode: strv(v.barcode), inventoryQty: typeof v.inventory_quantity === "number" ? v.inventory_quantity : null,
            selectedOptions: so,
          };
        }) as Vari[];
        if (Array.isArray(rp.images)) finalImgs = (rp.images as Record<string, unknown>[]).map((im, i) => ({
          id: strv(im.id), src: strv(im.src), altText: strv(im.alt), position: typeof im.position === "number" ? im.position : i + 1,
        }));
      }

      // Áp collections của template (POST collects.json từng collection — lỗi lẻ không chặn).
      const tpl = p.templateId ? tplById.get(p.templateId) : null;
      const tplCols = ((Array.isArray(tpl?.collections) ? tpl!.collections : []) as { id?: string; title?: string }[])
        .map((c) => ({ id: strv(c?.id), title: strv(c?.title) })).filter((c) => c.id);
      const appliedCols: { id: string; title: string }[] = [];
      for (const c of tplCols) {
        try {
          await shopbaseApi(cred!, "collects.json", { method: "POST", body: JSON.stringify({ collect: { product_id: Number(pid) || pid, collection_id: Number(c.id) || c.id } }) });
          appliedCols.push(c);
        } catch { /* collection có thể là smart / đã xoá — bỏ qua */ }
      }

      await db.update(schema.shopbaseProducts).set({
        shopbaseProductId: pid, handle,
        status: "DRAFT",
        variants: finalVars, images: finalImgs,
        collections: appliedCols,
        onlineStoreUrl: handle && host ? `https://${host}/products/${handle}` : null,
        dirty: false, pushedAt: new Date(), updatedAt: new Date(),
      }).where(eq(schema.shopbaseProducts.id, p.id));

      created++;
      results.push({ id: p.id, title: p.title, ok: true });
    } catch (e) {
      results.push({ id: p.id, title: p.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }

  return NextResponse.json({ ok: created > 0, created, failed: results.length - created, results });
}
