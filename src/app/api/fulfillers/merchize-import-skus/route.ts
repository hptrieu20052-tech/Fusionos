import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getMerchizeCatalog, extractMerchizeCatalog } from "@/lib/merchize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId, search? } — kéo catalog Merchize → tạo SKU mapping.
 * Auth Merchize dùng x-api-key (API Key), base URL = fulfillers.api_endpoint.
 * Trả kèm rawSample để mình soi cấu trúc nếu parse chưa khớp.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "thiếu fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller không tồn tại" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; apiToken?: string };
  const apiKey = c.apiKey || c.apiToken;
  const baseUrl = ff.apiEndpoint;
  if (!apiKey || !baseUrl) return NextResponse.json({ ok: false, error: "Chưa cấu hình Base URL + API Key cho Merchize" }, { status: 400 });

  let raw;
  try { raw = await getMerchizeCatalog(baseUrl, apiKey, { limit: 50, page: 1, search: b.search || undefined }); }
  catch (e) { return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 502 }); }

  const items = extractMerchizeCatalog(raw);

  const existing = await db.select({ sku: schema.skuMappings.internalSku }).from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
  const have = new Set(existing.map((x) => x.sku));
  let created = 0, skipped = 0;
  for (const it of items) {
    if (have.has(it.sku)) { skipped++; continue; }
    try {
      await db.insert(schema.skuMappings).values({
        internalSku: it.sku, fulfillerId: ff.id, fulfillerSku: it.sku,
        fulfillerProduct: it.title?.slice(0, 200) || null,
        baseCost: it.cost.toFixed(2), shipCost: "0",
      });
      created++;
    } catch { skipped++; }
  }

  // rawSample: 1 phần tử đầu của response để soi cấu trúc nếu parse chưa đúng
  const d = raw as Record<string, unknown>;
  const arr = (Array.isArray(d) ? d : d.data ?? d.products ?? d.items ?? []) as unknown[];
  const rawSample = Array.isArray(arr) ? arr[0] ?? null : null;

  return NextResponse.json({ ok: true, found: items.length, created, skipped, rawSample });
}
