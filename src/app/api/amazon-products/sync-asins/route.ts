import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { getSpConfig, spConfigured, getListing, sleep, touchSpSync } from "@/lib/amazon-sp-api";

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

  for (const r of scoped) {
    if (Date.now() > deadline) { errors.push("hết thời gian — chạy lại để tiếp tục"); break; }
    const root = rootSku(r.variants) || (r.manualSku ?? "");
    if (!root) continue;
    try {
      const info = await getListing(cfg!, `${root}-PARENT-AMZ`);
      if (!info) {
        // 404 — listing KHÔNG còn trên Amazon (đã xóa). Nếu DB còn Live/ASIN thì gỡ về DRAFT + xóa ASIN.
        if (r.asin) {
          await db.update(schema.amazonProducts).set({ asin: null, status: "DRAFT", updatedAt: new Date() }).where(eq(schema.amazonProducts.id, r.id));
          removed++;
        } else notFound++;
        await sleep(250);
        continue;
      }
      if (!info.asin) { notFound++; await sleep(250); continue; } // tồn tại nhưng chưa cấp ASIN (đang xử lý) → giữ nguyên
      const status = /BUYABLE|DISCOVERABLE/i.test(info.status) ? "LIVE" : "EXPORTED";
      await db.update(schema.amazonProducts)
        .set({ asin: info.asin, status, updatedAt: new Date() })
        .where(eq(schema.amazonProducts.id, r.id));
      updated++;
    } catch (e) {
      if (errors.length < 3) errors.push(String((e as Error)?.message ?? e).slice(0, 160));
    }
    await sleep(250); // ~4 req/s, dưới trần rate limit
  }

  await touchSpSync(cfg!.storeId);
  return NextResponse.json({ ok: true, updated, notFound, removed, errors });
}
