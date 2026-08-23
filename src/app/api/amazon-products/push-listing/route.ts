import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { getSpConfig, spConfigured, patchListingItem, MK_US, vText, sleep, type PatchOp } from "@/lib/amazon-sp-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/amazon-products/push-listing { ids, storeId? }
 *
 * ⬆ Push to Amazon — CẬP NHẬT listing đã live qua Listings Items API (PATCH), KHÔNG dùng Feeds
 * (feed flat-file bị Amazon chặn 403). Update title/bullets/description/giá theo từng SKU.
 * Listing CHƯA có ASIN (chưa tạo trên Amazon) → bỏ qua, báo dùng "tải file" để tạo mới.
 * LUÔN trả JSON.
 */
const PRODUCT_TYPE = "DISPLAY_ALBUM"; // các listing sách của Talewix đều product type này

type Variation = { suffix: string; label: string; price: string };
type Variant = { sku?: string | null };
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
const plain = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const mk = MK_US;

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const b = await req.json().catch(() => null);
    const storeId = typeof b?.storeId === "string" && /^[0-9a-f-]{36}$/i.test(b.storeId) ? b.storeId : undefined;
    const ids: string[] = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x)));
    if (!ids.length) return NextResponse.json({ ok: false, error: "Chưa chọn listing nào" }, { status: 200 });

    const cfg = await getSpConfig(storeId);
    if (!spConfigured(cfg)) return NextResponse.json({ ok: false, error: "Chưa cấu hình SP-API — mở store Amazon ở Stores." }, { status: 200 });

    const rows = await db.select({
      a: schema.amazonProducts,
      srcVariants: schema.shopifyProducts.variants, srcType: schema.shopifyProducts.productType,
      seller: schema.stores.sellerId,
    }).from(schema.amazonProducts)
      .leftJoin(schema.shopifyProducts, eq(schema.shopifyProducts.id, schema.amazonProducts.shopifyProductId))
      .leftJoin(schema.stores, eq(schema.stores.id, schema.amazonProducts.storeId))
      .where(inArray(schema.amazonProducts.id, ids));
    const scopeIds = await storeOwnerScopeIds(session);
    if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const tpls = await db.select().from(schema.amazonTemplates);
    const tplVarsFor = (amazonTemplateId: string | null, productType: string | null): Variation[] => {
      let t = amazonTemplateId ? tpls.find((x) => x.id === amazonTemplateId) : undefined;
      if (!t) { const pt = (productType ?? "").trim().toLowerCase(); if (pt) t = tpls.find((x) => (x.productType ?? "").trim().toLowerCase() === pt); }
      if (!t && tpls.length === 1) t = tpls[0];
      return ((t?.config as { variations?: Variation[] } | null)?.variations ?? []).filter((v) => v.suffix);
    };

    let updated = 0;
    const skipped: string[] = [];
    const issues: string[] = [];
    const deadline = Date.now() + 50_000;

    for (const r of rows) {
      if (Date.now() > deadline) { skipped.push("hết thời gian — chạy lại để tiếp tục"); break; }
      const title = (r.a.title ?? "").trim();
      const bullets = ((r.a.bullets as string[] | null) ?? []).filter(Boolean);
      const desc = plain(r.a.description);
      const root = rootSku(r.srcVariants, r.a.manualSku);
      const ovr = (Array.isArray(r.a.variations) ? r.a.variations : []) as Variation[];
      const vars = (ovr.length ? ovr : tplVarsFor(r.a.amazonTemplateId, r.srcType || r.a.manualType)).filter((v) => v.suffix);

      if (!r.a.asin) { skipped.push(`${title || root || r.a.id}: chưa có trên Amazon — dùng "tải file" để tạo mới`); continue; }
      if (!root || !title) { skipped.push(`${title || r.a.id}: thiếu SKU/title`); continue; }

      const bulletVals = bullets.slice(0, 5).map((v) => ({ value: v, marketplace_id: mk, language_tag: "en_US" }));
      const commonPatches: PatchOp[] = [
        { op: "replace", path: "/attributes/product_description", value: vText(desc, mk) },
      ];
      if (bulletVals.length) commonPatches.push({ op: "replace", path: "/attributes/bullet_point", value: bulletVals });

      // PARENT — title + bullets + description (không giá)
      try {
        await patchListingItem(cfg!, `${root}-PARENT-AMZ`, PRODUCT_TYPE, [
          { op: "replace", path: "/attributes/item_name", value: vText(title, mk) },
          ...commonPatches,
        ]);
        updated++;
      } catch (e) { if (issues.length < 4) issues.push(String((e as Error)?.message ?? e).slice(0, 140)); }
      await sleep(300);

      // CHILDREN — title(+size) + bullets + desc + GIÁ
      for (const v of vars) {
        if (Date.now() > deadline) break;
        const price = Number(v.price);
        const childPatches: PatchOp[] = [
          { op: "replace", path: "/attributes/item_name", value: vText(`${title} (${v.label || v.suffix})`.slice(0, 200), mk) },
          ...commonPatches,
        ];
        if (!isNaN(price) && price > 0) {
          childPatches.push({ op: "replace", path: "/attributes/purchasable_offer", value: [{ marketplace_id: mk, currency: "USD", our_price: [{ schedule: [{ value_with_tax: price }] }] }] });
        }
        try { await patchListingItem(cfg!, `${root}-${v.suffix}`, PRODUCT_TYPE, childPatches); updated++; }
        catch (e) { if (issues.length < 4) issues.push(String((e as Error)?.message ?? e).slice(0, 140)); }
        await sleep(300);
      }
    }

    // đánh dấu EXPORTED cho các bản đã cập nhật (có asin)
    const pushedIds = rows.filter((r) => r.a.asin).map((r) => r.a.id);
    if (pushedIds.length) await db.update(schema.amazonProducts).set({ status: "EXPORTED", exportedAt: new Date(), updatedAt: new Date() }).where(inArray(schema.amazonProducts.id, pushedIds)).catch(() => {});

    return NextResponse.json({
      ok: true,
      updated,
      skipped,
      issues,
      summary: `Đã cập nhật ${updated} SKU qua API${skipped.length ? ` · ${skipped.length} bỏ qua` : ""}${issues.length ? ` · lỗi: ${issues[0]}` : ""}. Bấm ⟳ Sync để cập nhật trạng thái.`,
    });
  } catch (e) {
    console.error("push-listing fatal", e);
    return NextResponse.json({ ok: false, error: "Lỗi máy chủ khi push: " + String((e as Error)?.message ?? e).slice(0, 220) }, { status: 200 });
  }
}
