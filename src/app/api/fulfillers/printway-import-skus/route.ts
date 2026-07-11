import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listPrintwaySkuCatalogs, flattenPwCatalogItem, getPrintwayShippingMethods, pwNum, type PwSkuRow } from "@/lib/printway-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET — DEBUG: trả raw JSON trang 1 catalog Printway (mở trực tiếp trên browser khi đã đăng nhập).
 * Tự tìm fulfiller tên chứa "printway". Dùng để soi cấu trúc thật khi parser lệch.
 */
export async function GET() {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const fulfillers = await db.select().from(schema.fulfillers);
  const ff = fulfillers.find((f) => f.name.toLowerCase().includes("printway"));
  if (!ff) return NextResponse.json({ ok: false, error: "no printway fulfiller" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; accessToken?: string; apiToken?: string };
  const accessToken = c.apiKey || c.accessToken || c.apiToken;
  if (!accessToken) return NextResponse.json({ ok: false, error: "no token" }, { status: 400 });
  try {
    const { items, raw } = await listPrintwaySkuCatalogs({ accessToken, endpoint: ff.apiEndpoint }, 1, 5);
    return NextResponse.json({ ok: true, itemCount: items.length, firstItems: items.slice(0, 3), raw });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 });
  }
}

/**
 * POST { fulfillerId } — kéo catalog SKU Printway → UPSERT vào skuMappings:
 * - SKU mới → insert (fulfiller_product_id = variant_id, base = giá catalog).
 * - SKU đã có → cập nhật product/variant/variant_id; base/ship chỉ ghi đè khi đang = 0
 *   (không phá giá đã sửa tay). Chạy lại nút Update SKU là fix được các dòng thiếu.
 * - Catalog trả product LỒNG variants → parser tự đào xuống (flattenPwCatalogItem).
 * - Enrich ship cost best-effort qua /products/retrieved-shipping-methods cho các dòng ship = 0.
 * Trả kèm rawSample + shipSample để soi cấu trúc nếu parse chưa khớp.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; accessToken?: string; apiToken?: string };
  const accessToken = c.apiKey || c.accessToken || c.apiToken;
  if (!accessToken) return NextResponse.json({ ok: false, error: "Printway Access Token not configured (Settings → API Key)" }, { status: 400 });
  const cred = { accessToken, endpoint: ff.apiEndpoint };

  // ---- 1. Kéo catalog: thử phân trang; nếu server bỏ qua ?page thì tự dừng khi trang lặp lại ----
  const start = Date.now();
  const rows: PwSkuRow[] = [];
  let rawSample: unknown = null;
  const firstOfPage = new Set<string>();
  try {
    for (let page = 1; page <= 40; page++) {
      if (Date.now() - start > 30000) break;
      const { items, raw } = await listPrintwaySkuCatalogs(cred, page, 100);
      if (!rawSample) rawSample = Array.isArray(items) && items.length ? items[0] : raw;
      if (!items.length) break;
      const key = JSON.stringify(items[0]).slice(0, 200);
      if (firstOfPage.has(key)) break;
      firstOfPage.add(key);
      for (const it of items) rows.push(...flattenPwCatalogItem(it));
      if (items.length < 100) break;
      await new Promise((r) => setTimeout(r, 120)); // rate limit 50 req/3s
    }
  } catch (e) { return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300), rawSample }, { status: 500 }); }

  // ---- 2. UPSERT theo LÔ (catalog ~1000 product × hàng chục variant → vài chục nghìn dòng) ----
  const existing = await db.select({
    id: schema.skuMappings.id, sku: schema.skuMappings.internalSku,
    base: schema.skuMappings.baseCost, ship: schema.skuMappings.shipCost,
    variant: schema.skuMappings.variant, pid: schema.skuMappings.fulfillerProductId,
  }).from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
  const byKey = new Map(existing.map((x) => [x.sku, x]));

  // Trùng SKU trong catalog: ưu tiên dòng CÓ variant/giá; dedupe
  rows.sort((a, b) => ((b.variant ? 1 : 0) + (b.cost > 0 ? 1 : 0)) - ((a.variant ? 1 : 0) + (a.cost > 0 ? 1 : 0)));
  let created = 0, updated = 0, skipped = 0;
  const seen = new Set<string>();
  const variantIdBySku = new Map<string, string>(); // cho bước enrich ship
  const toInsert: (typeof schema.skuMappings.$inferInsert)[] = [];
  for (const it of rows) {
    const sku = it.sku || it.variantId;
    if (!sku || seen.has(sku)) { skipped++; continue; }
    seen.add(sku);
    if (it.variantId) variantIdBySku.set(sku, it.variantId);
    const ex = byKey.get(sku);
    if (!ex) {
      toInsert.push({
        internalSku: sku, fulfillerId: ff.id, fulfillerSku: sku,
        productType: it.product?.slice(0, 120) || null,
        fulfillerProduct: it.product?.slice(0, 200) || null,
        variant: it.variant?.slice(0, 120) || null,
        fulfillerProductId: it.variantId || null,
        baseCost: it.cost.toFixed(2), shipCost: it.ship.toFixed(2),
      });
    } else {
      // Chỉ update dòng ĐÃ có (điền variant/variant_id còn thiếu; giá chỉ đè khi đang = 0)
      const patch: Record<string, unknown> = {};
      if (it.product) { patch.productType = it.product.slice(0, 120); patch.fulfillerProduct = it.product.slice(0, 200); }
      if (it.variant && it.variant !== ex.variant) patch.variant = it.variant.slice(0, 120);
      if (it.variantId && it.variantId !== ex.pid) patch.fulfillerProductId = it.variantId;
      if (it.cost > 0 && pwNum(ex.base) === 0) patch.baseCost = it.cost.toFixed(2);
      if (it.ship > 0 && pwNum(ex.ship) === 0) patch.shipCost = it.ship.toFixed(2);
      if (Object.keys(patch).length) {
        try { await db.update(schema.skuMappings).set(patch).where(eq(schema.skuMappings.id, ex.id)); updated++; } catch { skipped++; }
      } else skipped++;
    }
  }
  // Insert theo lô 1000 — trùng (unique internalSku+fulfillerId) thì bỏ qua
  for (let i = 0; i < toInsert.length; i += 1000) {
    if (Date.now() - start > 50000) { skipped += toInsert.length - i; break; }
    const chunk = toInsert.slice(i, i + 1000);
    try {
      const r = await db.insert(schema.skuMappings).values(chunk).onConflictDoNothing().returning({ id: schema.skuMappings.id });
      created += r.length;
      skipped += chunk.length - r.length;
    } catch { skipped += chunk.length; }
  }

  // ---- 3. Enrich ship cost (best-effort, budget 15s): các dòng ship = 0 có variant_id ----
  let shipUpdated = 0; let shipSample: unknown = null;
  try {
    const need = existing.filter((x) => pwNum(x.ship) === 0 && (x.pid || variantIdBySku.get(x.sku))).slice(0, 600);
    // Dòng vừa insert chưa nằm trong `existing` → gom thêm từ catalog vừa kéo
    const fromNew = rows.filter((r) => r.ship === 0 && r.variantId && !byKey.has(r.sku || r.variantId)).slice(0, 600);
    const targets = new Map<string, string>(); // variantId -> sku
    for (const x of need) targets.set(String(x.pid || variantIdBySku.get(x.sku)), x.sku);
    for (const r of fromNew) targets.set(r.variantId, r.sku || r.variantId);
    const vids = Array.from(targets.keys());
    for (let i = 0; i < vids.length && Date.now() - start < 45000; i += 100) {
      const batch = vids.slice(i, i + 100);
      const { items, raw } = await getPrintwayShippingMethods(cred, { variantIds: batch });
      if (!shipSample) shipSample = Array.isArray(items) && items.length ? items[0] : raw;
      for (const it of items) {
        const o = it as Record<string, unknown>;
        const vid = String(o.variant_id ?? o.variantId ?? o.id ?? "");
        const sku = targets.get(vid) || String(o.sku ?? o.item_sku ?? "");
        if (!sku) continue;
        // Giá ship: lấy method rẻ nhất trong mảng methods/shipping_methods, hoặc field trực tiếp
        let price = 0;
        const methods = (Array.isArray(o.methods) ? o.methods : Array.isArray(o.shipping_methods) ? o.shipping_methods : Array.isArray(o.data) ? o.data : []) as Record<string, unknown>[];
        if (methods.length) {
          const prices = methods.map((m) => pwNum(m.price ?? m.fee ?? m.cost ?? m.amount ?? m.ship_cost ?? m.shipping_fee)).filter((n) => n > 0);
          if (prices.length) price = Math.min(...prices);
        } else {
          price = pwNum(o.price ?? o.fee ?? o.cost ?? o.ship_cost ?? o.shipping_fee);
        }
        if (price > 0) {
          await db.update(schema.skuMappings).set({ shipCost: price.toFixed(2) })
            .where(and(eq(schema.skuMappings.fulfillerId, ff.id), eq(schema.skuMappings.internalSku, sku)));
          shipUpdated++;
        }
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  } catch { /* enrich fail không chặn import */ }

  return NextResponse.json({ ok: true, found: rows.length, created, updated, skipped, shipUpdated, rawSample, shipSample });
}
