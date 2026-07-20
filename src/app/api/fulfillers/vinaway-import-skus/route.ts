import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listVinawayProducts, listVinawaySkus, type VinawayCred } from "@/lib/vinaway";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId } — kéo catalog Vinaway → UPSERT skuMappings.
 * GET /products (product_id) + GET /product-skus (variant id) → fulfillerSku = "product_id:sku_id"
 * (đúng định dạng adapter Vinaway cần khi tạo đơn). Ghép product theo product_name.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as Record<string, string>;
  const email = c.email || c.identifier || c.userName || "";
  const password = c.password || c.apiKey || "";
  if (!email || !password) return NextResponse.json({ ok: false, error: "Vinaway cần Identifier (email) + API Key (password) trong Settings" }, { status: 400 });
  const cred: VinawayCred = { endpoint: ff.apiEndpoint, email, password };

  const start = Date.now();
  try {
    // ---- 1. Sản phẩm: map name → product_id ----
    const pidByName = new Map<string, number>();
    for (let page = 1; page <= 20; page++) {
      const r = await listVinawayProducts(cred, page, 100);
      for (const p of r.data) if (p?.name) pidByName.set(p.name.trim().toLowerCase(), p.id);
      if (r.data.length < 100 || Date.now() - start > 15000) break;
    }

    // ---- 2. Variant SKUs ----
    const rows: { id: number; sku: string; product_id?: number; product_name?: string; color?: string; size?: string }[] = [];
    for (let page = 1; page <= 40; page++) {
      const r = await listVinawaySkus(cred, page, 100);
      rows.push(...r.data);
      if (r.data.length < 100 || Date.now() - start > 35000) break;
    }

    const existing = await db.select({ sku: schema.skuMappings.internalSku })
      .from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
    const haveSku = new Set(existing.map((x) => x.sku));

    let created = 0, unmatched = 0;
    const toInsert: (typeof schema.skuMappings.$inferInsert)[] = [];
    for (const it of rows) {
      const sku = (it.sku ?? "").trim() || String(it.id);
      if (!sku || haveSku.has(sku)) continue;
      haveSku.add(sku);
      // Ưu tiên product_id trả thẳng trong response; fallback ghép theo tên sản phẩm.
      const pid = it.product_id || pidByName.get((it.product_name ?? "").trim().toLowerCase());
      if (!pid) unmatched++;
      toInsert.push({
        internalSku: sku, fulfillerId: ff.id,
        // "product_id:sku_id" — đúng format adapter Vinaway; không khớp được product thì để sku_id trần (sửa tay sau).
        fulfillerSku: pid ? `${pid}:${it.id}` : String(it.id),
        productType: it.product_name?.slice(0, 120) || null,
        fulfillerProduct: it.product_name?.slice(0, 200) || null,
        variant: [it.color, it.size].filter(Boolean).join(" / ").slice(0, 120) || null,
        fulfillerProductId: String(it.id),
        baseCost: "0", shipCost: "0",
      });
    }
    for (let i = 0; i < toInsert.length; i += 500) {
      const r = await db.insert(schema.skuMappings).values(toInsert.slice(i, i + 500)).onConflictDoNothing().returning({ id: schema.skuMappings.id });
      created += r.length;
    }

    return NextResponse.json({
      ok: true, created, found: rows.length, skipped: rows.length - toInsert.length, unmatched,
      note: unmatched ? `${unmatched} SKU không khớp được product_id theo tên — các dòng đó cần sửa fulfillerSku thành "product_id:sku_id" thủ công.` : undefined,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 });
  }
}
