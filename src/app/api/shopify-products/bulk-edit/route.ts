import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

type Variant = { id: string; price: string; compareAtPrice: string | null; sku: string; selectedOptions: { name: string; value: string }[]; inventoryQty: number | null };

// Làm tròn: "none" = 2 chữ số; "99" = về mức .99 gần nhất (charm pricing).
function roundPrice(x: number, round: string): number {
  if (!isFinite(x) || x < 0) x = 0;
  if (round === "99") { const base = Math.max(0, Math.round(x - 0.99)); return base + 0.99; }
  return Math.round(x * 100) / 100;
}
const fx = (n: number) => n.toFixed(2);

/**
 * POST /api/shopify-products/bulk-edit  { ids, action, ... }
 *   action = "set_all"   { price }                         → mọi variant về 1 giá
 *   action = "adjust"    { dir: inc|dec, mode: pct|amt, value, round? } → tăng/giảm giá
 *   action = "sale_apply"{ pct, round? }  → Price = giá gốc*(1-pct); Compare-at = giá gốc (giữ giá gốc nếu đã sale)
 *   action = "sale_clear"{}               → Price = Compare-at; Compare-at = null
 * Đổi variants jsonb + đánh dấu dirty. Frontend tự Push sau đó.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const action = String(b?.action ?? "");
  if (!["set_all", "adjust", "sale_apply", "sale_clear"].includes(action)) return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });

  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 500);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });

  const round = String(b?.round ?? "none");
  const value = Number(b?.value); // adjust
  const price = Number(b?.price); // set_all
  const pct = Number(b?.pct);     // sale_apply / adjust pct
  const dir = String(b?.dir ?? "inc");
  const mode = String(b?.mode ?? "pct");

  if (action === "set_all" && (!isFinite(price) || price < 0)) return NextResponse.json({ ok: false, error: "price required" }, { status: 400 });
  if (action === "adjust" && (!isFinite(value) || value <= 0)) return NextResponse.json({ ok: false, error: "value required" }, { status: 400 });
  if (action === "sale_apply" && (!isFinite(pct) || pct <= 0 || pct >= 100)) return NextResponse.json({ ok: false, error: "pct must be 1–99" }, { status: 400 });

  const rows = await db.select({ id: schema.shopifyProducts.id, variants: schema.shopifyProducts.variants, seller: schema.stores.sellerId })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  if (!rows.length) return NextResponse.json({ ok: false, error: "no products" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  let updated = 0, variantsSet = 0;
  for (const r of rows) {
    const vs = (Array.isArray(r.variants) ? r.variants as Variant[] : []);
    let touched = false;
    for (const v of vs) {
      const cur = Number(v.price); const curValid = isFinite(cur) && cur >= 0;
      if (action === "set_all") {
        v.price = fx(roundPrice(price, round)); touched = true; variantsSet++;
      } else if (action === "adjust") {
        if (!curValid) continue;
        let nx = cur;
        if (mode === "pct") nx = dir === "inc" ? cur * (1 + value / 100) : cur * (1 - value / 100);
        else nx = dir === "inc" ? cur + value : cur - value;
        v.price = fx(roundPrice(Math.max(0, nx), round)); touched = true; variantsSet++;
      } else if (action === "sale_apply") {
        // Giá gốc = compareAtPrice nếu đang sale, else giá hiện tại → không cộng dồn khi bấm lại.
        const orig = (v.compareAtPrice != null && String(v.compareAtPrice).trim() !== "" && Number(v.compareAtPrice) > 0) ? Number(v.compareAtPrice) : cur;
        if (!isFinite(orig) || orig <= 0) continue;
        v.compareAtPrice = fx(roundPrice(orig, "none"));
        v.price = fx(roundPrice(orig * (1 - pct / 100), round));
        touched = true; variantsSet++;
      } else if (action === "sale_clear") {
        if (v.compareAtPrice != null && String(v.compareAtPrice).trim() !== "" && Number(v.compareAtPrice) > 0) {
          v.price = fx(roundPrice(Number(v.compareAtPrice), "none"));
          v.compareAtPrice = null; touched = true; variantsSet++;
        }
      }
    }
    if (touched) { await db.update(schema.shopifyProducts).set({ variants: vs, dirty: true, updatedAt: new Date() }).where(eq(schema.shopifyProducts.id, r.id)); updated++; }
  }
  return NextResponse.json({ ok: true, updated, variantsSet });
}
