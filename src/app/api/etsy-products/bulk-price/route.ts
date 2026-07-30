import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/etsy-products/bulk-price
 *   { ids }                    → PREVIEW: trả về danh sách giá trị biến thể (gộp) của các listing đã chọn,
 *                                kèm giá hiện có (variantPrices) để điền sẵn.
 *   { ids, prices: {val:price}, base? } → APPLY: gán giá theo size cho MỌI listing đã chọn
 *                                (chỉ set cho size mà listing đó thật sự có). base = đặt luôn giá gốc (tuỳ chọn).
 * Seller chỉ thao tác trên listing thuộc store của mình.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 500);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });

  const rows = await db.select({
    id: schema.etsyProducts.id, storeId: schema.etsyProducts.storeId,
    variations: schema.etsyProducts.variations, variantPrices: schema.etsyProducts.variantPrices, price: schema.etsyProducts.price,
    storeSeller: schema.stores.sellerId,
  }).from(schema.etsyProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.etsyProducts.storeId))
    .where(inArray(schema.etsyProducts.id, ids));
  if (!rows.length) return NextResponse.json({ ok: false, error: "no listings found" }, { status: 404 });

  // Scope seller
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.storeSeller || !scopeIds.includes(r.storeSeller))) {
    return NextResponse.json({ ok: false, error: "forbidden: some listings are not in your stores" }, { status: 403 });
  }

  const valuesOf = (v: unknown) => (Array.isArray(v) ? v as { name?: string; values?: string[] }[] : [])
    .flatMap((x) => (x.values ?? []).map((val) => ({ name: String(x.name ?? ""), value: String(val) })))
    .filter((x) => x.value && !/digital/i.test(x.value));

  const prices = (b?.prices && typeof b.prices === "object") ? b.prices as Record<string, unknown> : null;

  // ---- PREVIEW ----
  if (!prices) {
    const map = new Map<string, { name: string; value: string; count: number; current: string }>();
    for (const r of rows) {
      const cur = (r.variantPrices && typeof r.variantPrices === "object" ? r.variantPrices : {}) as Record<string, string>;
      for (const { name, value } of valuesOf(r.variations)) {
        const hit = map.get(value);
        if (hit) hit.count++;
        else map.set(value, { name, value, count: 1, current: cur[value] ?? "" });
      }
    }
    const values = Array.from(map.values()).sort((a, b2) => a.value.localeCompare(b2.value, undefined, { numeric: true }));
    return NextResponse.json({ ok: true, count: rows.length, values });
  }

  // ---- APPLY ----
  // Chuẩn hoá prices: bỏ giá trị rỗng, ép về chuỗi số hợp lệ.
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(prices)) {
    const s = String(v ?? "").trim();
    if (s === "") continue;
    const n = Number(s);
    if (isNaN(n) || n < 0) continue;
    clean[k] = n.toFixed(2);
  }
  const base = (b?.base != null && String(b.base).trim() !== "" && !isNaN(Number(b.base)) && Number(b.base) >= 0)
    ? Number(b.base).toFixed(2) : null;

  let updated = 0;
  for (const r of rows) {
    const has = new Set(valuesOf(r.variations).map((x) => x.value));
    const cur = (r.variantPrices && typeof r.variantPrices === "object" ? { ...(r.variantPrices as Record<string, string>) } : {});
    let touched = false;
    for (const [val, price] of Object.entries(clean)) {
      if (has.has(val)) { cur[val] = price; touched = true; }
    }
    const patch: Record<string, unknown> = {};
    if (touched) patch.variantPrices = cur;
    if (base != null) patch.price = base;
    if (Object.keys(patch).length) {
      patch.updatedAt = new Date();
      await db.update(schema.etsyProducts).set(patch).where(eq(schema.etsyProducts.id, r.id));
      updated++;
    }
  }
  return NextResponse.json({ ok: true, updated, sizes: Object.keys(clean).length });
}
