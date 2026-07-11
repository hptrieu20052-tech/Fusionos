import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getMerchizeCatalog, extractCatalogProducts, catalogVariantsOf } from "@/lib/merchize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId } — điền màu/size (+ base tier1 + ship US) cho SKU Merchize đang trống.
 * Đọc THẲNG từ catalog (đã kèm variants[].attributes/tiers/shipping) — không cần all-variants.
 * Không xoá, chỉ UPDATE. Chạy tăng dần theo trang (bấm lại nếu còn).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; apiToken?: string };
  const apiKey = c.apiKey || c.apiToken;
  const baseUrl = ff.apiEndpoint;
  if (!apiKey || !baseUrl) return NextResponse.json({ ok: false, error: "Base URL + API Key not configured" }, { status: 400 });

  const startPage = Math.max(Number(b.page) || 1, 1);
  const LIMIT = 50, BUDGET_MS = 45000;
  const start = Date.now();
  let page = startPage, pages = 0, updated = 0, done = false;

  try {
    for (; ; page++) {
      if (Date.now() - start > BUDGET_MS) break;
      const raw = await getMerchizeCatalog(baseUrl, apiKey, { limit: LIMIT, page });
      const products = extractCatalogProducts(raw);
      pages++;
      const rows = products.flatMap((p) => catalogVariantsOf(p)).filter((r) => r.sku && r.variant);
      if (rows.length) {
        const values = sql.join(rows.map((r) => sql`(${r.sku}, ${r.variant}, ${r.base}::numeric, ${r.ship}::numeric)`), sql`, `);
        const res = await db.execute(sql`
          UPDATE sku_mappings AS m
          SET variant   = COALESCE(NULLIF(m.variant, ''), v.variant),
              base_cost = CASE WHEN m.base_cost = 0 THEN v.base ELSE m.base_cost END,
              ship_cost = CASE WHEN m.ship_cost = 0 THEN v.ship ELSE m.ship_cost END
          FROM (VALUES ${values}) AS v(sku, variant, base, ship)
          WHERE m.fulfiller_id = ${ff.id} AND m.fulfiller_sku = v.sku
            AND (NULLIF(m.variant, '') IS NULL OR m.base_cost = 0 OR m.ship_cost = 0)
        `);
        updated += (res as { rowCount?: number }).rowCount ?? 0;
      }
      if (products.length < LIMIT) { done = true; break; }
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated, pages, done, nextPage: done ? null : page });
}
