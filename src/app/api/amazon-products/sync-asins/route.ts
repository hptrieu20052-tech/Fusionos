import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { getSpConfig, spConfigured, getListing, getListingData, sleep, touchSpSync } from "@/lib/amazon-sp-api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/amazon-products/sync-asins  { ids? }
 *
 * Tự lấy ASIN + trạng thái qua SP-API (Listings Items) cho từng listing — khớp bằng
 * Seller SKU của dòng PARENT ({root}-PARENT-AMZ). ids trống = tất cả trong phạm vi.
 * Không cần tải report tay. Gọi tuần tự có nghỉ để tránh rate limit.
 */
function rootSku(variants: unknown): string {
  const arr = (Array.isArray(variants) ? variants : []) as { sku?: string | null }[];
  for (const v of arr) {
    const s = String(v?.sku ?? "").trim();
    if (!s) continue;
    const parts = s.split("-").filter(Boolean);
    return parts.length >= 2 ? parts.slice(0, 2).join("-") : s;
  }
  return "";
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const storeId = typeof b?.storeId === "string" && /^[0-9a-f-]{36}$/i.test(b.storeId) ? b.storeId : undefined;
  const cfg = await getSpConfig(storeId);
  if (!spConfigured(cfg)) return NextResponse.json({ ok: false, error: "Chưa cấu hình SP-API — mở store Amazon ở mục Stores → khu Amazon SP-API để nhập Client ID / Secret / Refresh Token / Seller ID." }, { status: 400 });

  const onlyIds = Array.isArray(b?.ids) ? b.ids.filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))) : null;

  const rows = await db.select({
    id: schema.amazonProducts.id, variants: schema.shopifyProducts.variants,
    manualSku: schema.amazonProducts.manualSku, asin: schema.amazonProducts.asin,
    status: schema.amazonProducts.status,
    seller: schema.stores.sellerId,
  }).from(schema.amazonProducts)
    .leftJoin(schema.shopifyProducts, eq(schema.shopifyProducts.id, schema.amazonProducts.shopifyProductId))
    .leftJoin(schema.stores, eq(schema.stores.id, schema.amazonProducts.storeId));
  const scopeIds = await storeOwnerScopeIds(session);
  let scoped = scopeIds ? rows.filter((r) => r.seller && scopeIds.includes(r.seller)) : rows;
  if (onlyIds) scoped = scoped.filter((r) => onlyIds.includes(r.id));

  let updated = 0, notFound = 0, removed = 0;
  const errors: string[] = [];
  const deadline = Date.now() + 110_000;

  // Chỉ hỏi Amazon những listing ĐÃ TỪNG PUSH (có ASIN hoặc status ≠ DRAFT). Draft-chưa-push
  // không có trên Amazon → bỏ qua để không phí thời gian (tránh timeout khi có hàng trăm draft), trừ khi user chỉ định ids.
  const candidates = onlyIds ? scoped : scoped.filter((r) => r.asin || (r.status ?? "DRAFT") !== "DRAFT");
  const skippedDrafts = scoped.length - candidates.length;

  // ── PHA 1 (NHANH): status + ASIN parent cho MỌI listing. 1 call/listing → chạy được hàng trăm cái
  // trong ngân sách thời gian, KHÔNG kẹt vì bước lấy ASIN con (chậm). Có ASIN trên Amazon = LIVE —
  // KHÔNG dựa vào summaries.status (SP-API hay trả RỖNG cho hàng MoD/custom dù trang đã In stock).
  const liveList: { id: string; root: string; parentAsin: string }[] = [];
  for (const r of candidates) {
    if (Date.now() > deadline) { errors.push("hết thời gian ở bước status — chạy lại để tiếp tục"); break; }
    const root = rootSku(r.variants) || (r.manualSku ?? "");
    if (!root) continue;
    try {
      const info = await getListing(cfg!, `${root}-PARENT-AMZ`);
      if (!info) {
        // 404 — listing không còn trên Amazon (đã xóa). DB còn Live/ASIN thì gỡ về DRAFT + xóa ASIN.
        if (r.asin) { await db.update(schema.amazonProducts).set({ asin: null, status: "DRAFT", updatedAt: new Date() }).where(eq(schema.amazonProducts.id, r.id)); removed++; }
        else notFound++;
        await sleep(200); continue;
      }
      if (!info.asin) { notFound++; await sleep(200); continue; } // tồn tại nhưng chưa cấp ASIN (đang xử lý)
      await db.update(schema.amazonProducts)
        .set({ asin: info.asin, status: "LIVE", updatedAt: new Date() })
        .where(eq(schema.amazonProducts.id, r.id));
      updated++;
      liveList.push({ id: r.id, root, parentAsin: info.asin });
    } catch (e) {
      if (errors.length < 3) errors.push(String((e as Error)?.message ?? e).slice(0, 160));
    }
    await sleep(200); // ~5 req/s, dưới trần rate limit
  }

  // ── PHA 2 (BEST-EFFORT): ASIN từng size con → map {sku:asin} cho UI click mở link. Chạy tới khi hết giờ;
  // listing chưa kịp thì để lần sync sau — status đã đúng ở PHA 1 nên không ảnh hưởng.
  for (const it of liveList) {
    if (Date.now() > deadline) break;
    try {
      const skuAsins: Record<string, string> = { [`${it.root}-PARENT-AMZ`]: it.parentAsin };
      const pdata = await getListingData(cfg!, `${it.root}-PARENT-AMZ`, "relationships").catch(() => null);
      await sleep(150);
      const childSkus = ((pdata?.relationships as { childSkus?: string[] }[] | undefined) ?? []).flatMap((x) => x?.childSkus ?? []);
      for (const cs of childSkus.slice(0, 12)) {
        if (Date.now() > deadline) break;
        const ci = await getListing(cfg!, cs).catch(() => null);
        if (ci?.asin) skuAsins[cs] = ci.asin;
        await sleep(150);
      }
      await db.update(schema.amazonProducts).set({ skuAsins }).where(eq(schema.amazonProducts.id, it.id)).catch(() => {}); // bỏ qua nếu cột chưa migrate
    } catch { /* skuAsins best-effort */ }
  }

  await touchSpSync(cfg!.storeId);
  return NextResponse.json({ ok: true, updated, notFound, removed, skippedDrafts, errors });
}
