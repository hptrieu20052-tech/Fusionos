import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopHost, type ShopifyCred } from "@/lib/shopify";
import { updateProductText } from "@/lib/shopify-bulk";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/shopify-products/find-replace
 *   { ids: string[], find: string, replace: string, field?: "body" | "title", dryRun?: boolean }
 *
 * Thay chuỗi NGUYÊN VĂN (không regex) trong mô tả hoặc tiêu đề rồi ghi thẳng lên Shopify
 * bằng productUpdate — CHỈ field text đó, không đụng variants / giá / ảnh / collections / trạng thái.
 * dryRun = true: chỉ đếm xem bao nhiêu sản phẩm chứa chuỗi, không ghi gì.
 *
 * Cờ dirty giữ nguyên: sản phẩm đang có sửa đổi khác chưa Push thì vẫn còn dirty sau khi replace.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const find = String(b?.find ?? "");
  const replace = String(b?.replace ?? "");
  const field = String(b?.field ?? "body") === "title" ? "title" : "body";
  const dryRun = b?.dryRun === true;

  if (!find) return NextResponse.json({ ok: false, error: "find required" }, { status: 400 });
  if (find.length > 20000 || replace.length > 20000) return NextResponse.json({ ok: false, error: "text too long (max 20000 chars)" }, { status: 400 });

  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 100);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });

  const rows = await db.select({ p: schema.shopifyProducts, cred: schema.stores.apiCredentials, seller: schema.stores.sellerId, mk: schema.stores.marketplace })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  if (!rows.length) return NextResponse.json({ ok: false, error: "no products" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // ---- Dry run: chỉ đếm, KHÔNG gọi Shopify ----
  if (dryRun) {
    let matched = 0, hits = 0;
    const sample: string[] = [];
    for (const r of rows) {
      const cur = String((field === "title" ? r.p.title : r.p.bodyHtml) ?? "");
      const n = cur.split(find).length - 1;
      if (n > 0) { matched++; hits += n; if (sample.length < 5) sample.push(r.p.title); }
    }
    return NextResponse.json({ ok: true, dryRun: true, scanned: rows.length, matched, hits, sample });
  }

  const results: { id: string; title: string; ok: boolean; error?: string }[] = [];
  let skipped = 0;
  for (const r of rows) {
    const cur = String((field === "title" ? r.p.title : r.p.bodyHtml) ?? "");
    if (!cur.includes(find)) { skipped++; continue; }
    const next = cur.split(find).join(replace);
    if (next === cur) { skipped++; continue; }

    const cred = (r.cred ?? {}) as ShopifyCred;
    if (r.mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
      results.push({ id: r.p.id, title: r.p.title, ok: false, error: "store chưa cấu hình Shopify API" }); continue;
    }
    try {
      await updateProductText(cred, r.p.shopifyProductId, field === "title" ? { title: next } : { descriptionHtml: next });
      await db.update(schema.shopifyProducts)
        .set({ ...(field === "title" ? { title: next } : { bodyHtml: next }), pushedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.shopifyProducts.id, r.p.id));
      results.push({ id: r.p.id, title: next.slice(0, 80), ok: true });
    } catch (e) {
      results.push({ id: r.p.id, title: r.p.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }

  const done = results.filter((x) => x.ok).length;
  return NextResponse.json({ ok: done > 0 || results.length === 0, done, failed: results.length - done, skipped, results });
}
