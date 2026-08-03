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
 * POST /api/shopify-products/fill-sku { ids, prefix? }
 *
 * Sinh SKU cho variant ĐANG TRỐNG rồi ghi THẲNG lên Shopify (productVariantsBulkUpdate,
 * chỉ field inventoryItem.sku). Không đụng title/description/giá/ảnh/status ⇒ chạy được
 * trên listing đang sạch (dirty = false) mà không sợ ghi đè nội dung, và KHÔNG cần bấm Push.
 *
 * Dạng mã:  TLW-0007-8X8-GLO
 *   TLW   prefix (đổi được qua body.prefix)
 *   0007  số thứ tự SẢN PHẨM, cấp 1 lần rồi giữ nguyên vĩnh viễn
 *   8X8   3 ký tự alnum đầu của Option 1
 *   GLO   3 ký tự alnum đầu của Option 2 (có bao nhiêu option thì nối bấy nhiêu đoạn)
 *
 * LUẬT CỨNG — variant nào ĐÃ CÓ SKU thì BỎ QUA, tuyệt đối không ghi đè.
 * Google dùng mpn/sku để nhận diện sản phẩm: đổi SKU = Google coi như hàng mới,
 * mất sạch lịch sử hiệu suất và phải duyệt lại từ đầu.
 *
 * Số thứ tự lấy như sau: quét TOÀN BỘ sản phẩm của store (không chỉ mấy con đang chọn) để
 * biết số nào đã dùng, rồi cấp số trống tiếp theo theo thứ tự createdAt. Nhờ vậy chạy nhiều
 * lần / chọn từng nhóm nhỏ vẫn không đụng số, và sản phẩm mới thêm sau vẫn nối tiếp đúng.
 */
const MAX_IDS = 250;

const VARIANTS_UPDATE = `mutation fusionFillSku($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id }
    userErrors { field message }
  }
}`;

type SelOpt = { name?: string; value?: string };
type Variant = { id?: string; title?: string; selectedOptions?: SelOpt[]; sku?: string | null; [k: string]: unknown };

// "8x8 inches" → "8X8" · "Glossy Paper" → "GLO" · "" → ""
const code = (v: string) => v.replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(0, 3);

// Đoạn đuôi của SKU dựng từ selectedOptions; không có option nào thì trả "" (variant Default).
function suffix(v: Variant): string {
  const parts = (v.selectedOptions ?? [])
    .map((o) => code(String(o?.value ?? "")))
    .filter(Boolean);
  return parts.join("-");
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, MAX_IDS);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  // Prefix chỉ cho chữ/số, viết hoa, 2-6 ký tự — tránh đẻ ra SKU có ký tự lạ.
  const prefix = (typeof b?.prefix === "string" ? b.prefix : "TLW").replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(0, 6) || "TLW";

  const rows = await db.select({
    id: schema.shopifyProducts.id, gid: schema.shopifyProducts.shopifyProductId, title: schema.shopifyProducts.title,
    storeId: schema.shopifyProducts.storeId, variants: schema.shopifyProducts.variants, createdAt: schema.shopifyProducts.createdAt,
    cred: schema.stores.apiCredentials, seller: schema.stores.sellerId, mk: schema.stores.marketplace,
  }).from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  if (!rows.length) return NextResponse.json({ ok: false, error: "không tìm thấy sản phẩm" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // ---- Quét toàn store: số thứ tự đã dùng + mọi SKU đã tồn tại (để không cấp trùng) ----
  const storeIds = Array.from(new Set(rows.map((r) => r.storeId)));
  const all = await db.select({
    id: schema.shopifyProducts.id, storeId: schema.shopifyProducts.storeId,
    variants: schema.shopifyProducts.variants, createdAt: schema.shopifyProducts.createdAt,
  }).from(schema.shopifyProducts).where(inArray(schema.shopifyProducts.storeId, storeIds));

  const usedSeq = new Map<string, Set<number>>();     // storeId → số thứ tự đã dùng
  const usedSku = new Map<string, Set<string>>();     // storeId → SKU đã tồn tại
  const seqOfProduct = new Map<string, number>();     // productId → số thứ tự đã cấp trước đây
  const seqRe = new RegExp(`^${prefix}-(\\d{4,})-`);
  for (const p of all) {
    if (!usedSeq.has(p.storeId)) { usedSeq.set(p.storeId, new Set()); usedSku.set(p.storeId, new Set()); }
    for (const v of (Array.isArray(p.variants) ? p.variants as Variant[] : [])) {
      const sku = String(v?.sku ?? "").trim();
      if (!sku) continue;
      usedSku.get(p.storeId)!.add(sku);
      const m = seqRe.exec(sku);
      if (m) { const n = Number(m[1]); usedSeq.get(p.storeId)!.add(n); if (!seqOfProduct.has(p.id)) seqOfProduct.set(p.id, n); }
    }
  }
  // Con trỏ "số trống tiếp theo" cho từng store.
  const nextPtr = new Map<string, number>(storeIds.map((s) => [s, 1]));
  const takeSeq = (storeId: string): number => {
    const used = usedSeq.get(storeId) ?? new Set<number>();
    let n = nextPtr.get(storeId) ?? 1;
    while (used.has(n)) n++;
    used.add(n); nextPtr.set(storeId, n + 1);
    return n;
  };

  // Cấp số theo createdAt để thứ tự ổn định, không phụ thuộc thứ tự người dùng bấm chọn.
  const ordered = [...rows].sort((a, bb) => new Date(a.createdAt ?? 0).getTime() - new Date(bb.createdAt ?? 0).getTime());

  const results: { id: string; title: string; ok: boolean; filled?: number; skipped?: number; error?: string }[] = [];
  let totalFilled = 0, totalSkipped = 0;

  for (const r of ordered) {
    const cred = (r.cred ?? {}) as ShopifyCred;
    if (r.mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
      results.push({ id: r.id, title: r.title, ok: false, error: "store chưa cấu hình Shopify API" }); continue;
    }
    if (!r.gid) { results.push({ id: r.id, title: r.title, ok: false, error: "listing chưa có Shopify product ID — Sync lại" }); continue; }

    const variants = (Array.isArray(r.variants) ? r.variants as Variant[] : []);
    const blanks = variants.filter((v) => String(v?.id ?? "").startsWith("gid://") && !String(v?.sku ?? "").trim());
    const already = variants.length - blanks.length;
    if (!blanks.length) {
      totalSkipped += already;
      results.push({ id: r.id, title: r.title, ok: true, filled: 0, skipped: already }); continue;
    }

    // Số thứ tự: dùng lại số cũ nếu sản phẩm đã có ít nhất 1 SKU đúng dạng, không thì cấp số mới.
    const seq = seqOfProduct.get(r.id) ?? takeSeq(r.storeId);
    const pad = String(seq).padStart(4, "0");
    const skuSet = usedSku.get(r.storeId) ?? new Set<string>();

    const plan: { id: string; sku: string }[] = [];
    blanks.forEach((v, i) => {
      const tail = suffix(v) || `V${i + 1}`;
      let sku = `${prefix}-${pad}-${tail}`;
      // Hai variant ra cùng mã (vd "Glossy 8x8" và "Glossy 8x10" cùng ra 8X1) → nối số cho khác nhau.
      let n = 2;
      while (skuSet.has(sku)) { sku = `${prefix}-${pad}-${tail}-${n}`; n++; }
      skuSet.add(sku);
      plan.push({ id: String(v.id), sku });
    });

    try {
      const data = await shopifyGraphQL<{ productVariantsBulkUpdate?: { userErrors?: { message?: string }[] } }>(cred, VARIANTS_UPDATE, {
        productId: r.gid,
        variants: plan.map((p) => ({ id: p.id, inventoryItem: { sku: p.sku } })),
      });
      const errs = data.productVariantsBulkUpdate?.userErrors ?? [];
      if (errs.length) {
        results.push({ id: r.id, title: r.title, ok: false, error: errs.map((e) => e.message).join("; ").slice(0, 200) });
        continue;
      }
      // Ghi lại vào bản local để lần Push sau không đẩy SKU rỗng đè lên Shopify.
      const byId = new Map(plan.map((p) => [p.id, p.sku]));
      const merged = variants.map((v) => byId.has(String(v?.id)) ? { ...v, sku: byId.get(String(v.id))! } : v);
      await db.update(schema.shopifyProducts).set({ variants: merged, updatedAt: new Date() }).where(eq(schema.shopifyProducts.id, r.id));
      totalFilled += plan.length; totalSkipped += already;
      results.push({ id: r.id, title: r.title, ok: true, filled: plan.length, skipped: already });
    } catch (e) {
      results.push({ id: r.id, title: r.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }

  const done = results.filter((x) => x.ok).length;
  return NextResponse.json({
    ok: done > 0, pushed: done, failed: results.length - done,
    filled: totalFilled, skipped: totalSkipped, results,
  });
}
