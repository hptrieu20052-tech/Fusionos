import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

type Variant = { id: string; price: string; compareAtPrice: string | null; sku: string; selectedOptions: { name: string; value: string }[]; inventoryQty: number | null };

/**
 * POST /api/shopify-products/bulk-price
 *   { ids }                     → PREVIEW: giá trị option (gộp) của các sản phẩm đã chọn.
 *   { ids, prices: {value:price} } → APPLY: đặt giá cho MỌI variant có option value đó (đánh dấu dirty).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 500);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });

  const rows = await db.select({ id: schema.shopifyProducts.id, variants: schema.shopifyProducts.variants, seller: schema.stores.sellerId })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  if (!rows.length) return NextResponse.json({ ok: false, error: "no products" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const prices = (b?.prices && typeof b.prices === "object") ? b.prices as Record<string, unknown> : null;

  // PREVIEW: gộp mọi giá trị option (size/màu…) kèm giá đại diện hiện tại
  if (!prices) {
    const map = new Map<string, { name: string; value: string; count: number; current: string }>();
    for (const r of rows) {
      for (const v of (Array.isArray(r.variants) ? r.variants as Variant[] : [])) {
        for (const so of (v.selectedOptions ?? [])) {
          const key = so.value;
          const hit = map.get(key);
          if (hit) hit.count++;
          else map.set(key, { name: so.name, value: so.value, count: 1, current: v.price ?? "" });
        }
      }
    }
    const values = Array.from(map.values()).sort((a, c) => a.value.localeCompare(c.value, undefined, { numeric: true }));
    return NextResponse.json({ ok: true, count: rows.length, values });
  }

  // APPLY
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(prices)) {
    const s = String(v ?? "").trim(); if (s === "") continue;
    const n = Number(s); if (isNaN(n) || n < 0) continue; clean[k] = n.toFixed(2);
  }
  let updated = 0, variantsSet = 0;
  for (const r of rows) {
    const vs = (Array.isArray(r.variants) ? r.variants as Variant[] : []);
    let touched = false;
    for (const v of vs) {
      for (const so of (v.selectedOptions ?? [])) {
        if (clean[so.value] != null) { v.price = clean[so.value]; touched = true; variantsSet++; break; }
      }
    }
    if (touched) { await db.update(schema.shopifyProducts).set({ variants: vs, dirty: true, updatedAt: new Date() }).where(eq(schema.shopifyProducts.id, r.id)); updated++; }
  }
  return NextResponse.json({ ok: true, updated, variantsSet, sizes: Object.keys(clean).length });
}
