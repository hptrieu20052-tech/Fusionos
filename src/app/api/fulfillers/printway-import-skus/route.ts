import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
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
 * POST { fulfillerId, cursor? } — kéo catalog SKU Printway → UPSERT vào skuMappings.
 *
 * v639 · CHIA CHUYẾN (fix Cloudflare 504): catalog ~42k dòng, bản cũ kéo hết + update
 * TỪNG DÒNG trong 1 request → vượt 60s của Vercel → 504. Giờ mỗi request chỉ xử lý
 * tối đa PAGES_PER_CALL trang catalog trong ngân sách thời gian, trả { done, nextCursor }
 * — client (nút Update SKU) tự gọi lặp đến khi done. Hết catalog thì chạy 1 lượt enrich
 * ship cost rồi done=true. Quy tắc dữ liệu GIỮ NGUYÊN bản cũ:
 * - SKU mới → insert (fulfiller_product_id = variant_id, base = giá catalog).
 * - SKU đã có → chỉ điền product/variant/variant_id thiếu; giá chỉ ghi đè khi đang = 0.
 */
const PAGES_PER_CALL = 10;   // 10 trang × 100 product/trang ≈ vài nghìn dòng SKU mỗi chuyến
const PAGE_SIZE = 100;
const BUDGET_MS = 38000;     // ngân sách 1 request — dưới xa 60s Vercel/100s Cloudflare

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });
  const startPage = Math.max(1, Number(b.cursor ?? 1) || 1);

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; accessToken?: string; apiToken?: string };
  const accessToken = c.apiKey || c.accessToken || c.apiToken;
  if (!accessToken) return NextResponse.json({ ok: false, error: "Printway Access Token not configured (Settings → API Key)" }, { status: 400 });
  const cred = { accessToken, endpoint: ff.apiEndpoint };

  const start = Date.now();
  const left = () => BUDGET_MS - (Date.now() - start);

  // ---- 1. Kéo tối đa PAGES_PER_CALL trang catalog từ startPage ----
  const rows: PwSkuRow[] = [];
  let rawSample: unknown = null;
  let catalogDone = false;
  let lastPage = startPage - 1;
  const firstOfPage = new Set<string>();
  try {
    for (let page = startPage; page < startPage + PAGES_PER_CALL; page++) {
      if (left() < 12000) break; // chừa thời gian cho phần upsert
      const { items, raw } = await listPrintwaySkuCatalogs(cred, page, PAGE_SIZE);
      if (!rawSample) rawSample = Array.isArray(items) && items.length ? items[0] : raw;
      lastPage = page;
      if (!items.length) { catalogDone = true; break; }
      // Server bỏ qua ?page (trang nào cũng giống nhau) → dừng, coi như hết
      const key = JSON.stringify(items[0]).slice(0, 200);
      if (firstOfPage.has(key)) { catalogDone = true; break; }
      firstOfPage.add(key);
      for (const it of items) rows.push(...flattenPwCatalogItem(it));
      if (items.length < PAGE_SIZE) { catalogDone = true; break; }
      await new Promise((r) => setTimeout(r, 120)); // rate limit 50 req/3s
    }
  } catch (e) { return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300), rawSample }, { status: 500 }); }

  // ---- 2. UPSERT đúng phần SKU của chuyến này (SELECT theo inArray — không kéo cả bảng 42k dòng) ----
  // Trùng SKU trong chuyến: ưu tiên dòng CÓ variant/giá; dedupe
  rows.sort((a, b2) => ((b2.variant ? 1 : 0) + (b2.cost > 0 ? 1 : 0)) - ((a.variant ? 1 : 0) + (a.cost > 0 ? 1 : 0)));
  let created = 0, updated = 0, skipped = 0;
  const seen = new Set<string>();
  const batch: { sku: string; it: PwSkuRow }[] = [];
  for (const it of rows) {
    const sku = it.sku || it.variantId;
    if (!sku || seen.has(sku)) { skipped++; continue; }
    seen.add(sku);
    batch.push({ sku, it });
  }
  const byKey = new Map<string, { id: string; sku: string; base: string | null; ship: string | null; variant: string | null; pid: string | null }>();
  const allSkus = batch.map((x) => x.sku);
  for (let i = 0; i < allSkus.length; i += 500) {
    const part = await db.select({
      id: schema.skuMappings.id, sku: schema.skuMappings.internalSku,
      base: schema.skuMappings.baseCost, ship: schema.skuMappings.shipCost,
      variant: schema.skuMappings.variant, pid: schema.skuMappings.fulfillerProductId,
    }).from(schema.skuMappings)
      .where(and(eq(schema.skuMappings.fulfillerId, ff.id), inArray(schema.skuMappings.internalSku, allSkus.slice(i, i + 500))));
    for (const x of part) byKey.set(x.sku, x);
  }

  const toInsert: (typeof schema.skuMappings.$inferInsert)[] = [];
  let updatePending = 0;
  for (const { sku, it } of batch) {
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
      continue;
    }
    // Chỉ update dòng ĐÃ có (điền variant/variant_id còn thiếu; giá chỉ đè khi đang = 0)
    const patch: Record<string, unknown> = {};
    if (it.product) { patch.productType = it.product.slice(0, 120); patch.fulfillerProduct = it.product.slice(0, 200); }
    if (it.variant && it.variant !== ex.variant) patch.variant = it.variant.slice(0, 120);
    if (it.variantId && it.variantId !== ex.pid) patch.fulfillerProductId = it.variantId;
    if (it.cost > 0 && pwNum(ex.base) === 0) patch.baseCost = it.cost.toFixed(2);
    if (it.ship > 0 && pwNum(ex.ship) === 0) patch.shipCost = it.ship.toFixed(2);
    if (!Object.keys(patch).length) { skipped++; continue; }
    if (left() < 6000) { updatePending++; continue; } // hết giờ — trang này sẽ được kéo lại ở chuyến sau
    try { await db.update(schema.skuMappings).set(patch).where(eq(schema.skuMappings.id, ex.id)); updated++; } catch { skipped++; }
  }
  // Insert theo lô 1000 — trùng (unique internalSku+fulfillerId) thì bỏ qua
  for (let i = 0; i < toInsert.length; i += 1000) {
    if (left() < 4000) { updatePending += toInsert.length - i; break; }
    const chunk = toInsert.slice(i, i + 1000);
    try {
      const r = await db.insert(schema.skuMappings).values(chunk).onConflictDoNothing().returning({ id: schema.skuMappings.id });
      created += r.length;
      skipped += chunk.length - r.length;
    } catch { skipped += chunk.length; }
  }

  // Chuyến này chưa ghi hết (hết giờ) → chuyến sau kéo LẠI từ trang đầu của chuyến (idempotent)
  const retrySamePages = updatePending > 0;
  const nextCursor = retrySamePages ? startPage : lastPage + 1;

  // ---- 3. Hết catalog → 1 lượt enrich ship cost (best-effort) cho các dòng ship = 0 có variant_id ----
  let shipUpdated = 0; let shipSample: unknown = null;
  if (catalogDone && !retrySamePages) {
    try {
      const need = await db.select({
        sku: schema.skuMappings.internalSku, pid: schema.skuMappings.fulfillerProductId, ship: schema.skuMappings.shipCost,
      }).from(schema.skuMappings)
        .where(and(eq(schema.skuMappings.fulfillerId, ff.id), eq(schema.skuMappings.shipCost, "0.00"), isNotNull(schema.skuMappings.fulfillerProductId), ne(schema.skuMappings.fulfillerProductId, "")))
        .limit(600);
      const targets = new Map<string, string>(); // variantId -> sku
      for (const x of need) targets.set(String(x.pid), x.sku);
      const vids = Array.from(targets.keys());
      for (let i = 0; i < vids.length && left() > 6000; i += 100) {
        const batch2 = vids.slice(i, i + 100);
        const { items, raw } = await getPrintwayShippingMethods(cred, { variantIds: batch2 });
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
  }

  const done = catalogDone && !retrySamePages;
  return NextResponse.json({
    ok: true, done, nextCursor: done ? null : nextCursor,
    pageFrom: startPage, pageTo: lastPage,
    found: rows.length, created, updated, skipped, shipUpdated, rawSample, shipSample,
  });
}
