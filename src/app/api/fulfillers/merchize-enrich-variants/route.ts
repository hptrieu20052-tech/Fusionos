import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getMerchizeVariants, extractMerchizeVariants } from "@/lib/merchize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId } — lấy nhãn màu/size (variant title) cho các SKU Merchize đang TRỐNG variant.
 * Không xoá, không đụng ghim/giá — chỉ UPDATE cột variant. Chạy tăng dần (bấm lại nếu còn).
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
  if (!apiKey || !baseUrl) return NextResponse.json({ ok: false, error: "Chưa cấu hình Base URL + API Key" }, { status: 400 });

  const emptyVariant = sql`(${schema.skuMappings.variant} IS NULL OR ${schema.skuMappings.variant} = '')`;

  // Các product còn SKU trống variant (mỗi product gọi all-variants 1 lần)
  const need = await db.selectDistinct({ pid: schema.skuMappings.fulfillerProductId })
    .from(schema.skuMappings)
    .where(and(eq(schema.skuMappings.fulfillerId, ff.id), isNotNull(schema.skuMappings.fulfillerProductId), emptyVariant));
  const pids = need.map((x) => x.pid).filter(Boolean) as string[];

  const start = Date.now();
  const BATCH = 6, BUDGET_MS = 45000;
  let processed = 0, updated = 0;
  for (let i = 0; i < pids.length; i += BATCH) {
    if (Date.now() - start > BUDGET_MS) break;
    const batch = pids.slice(i, i + BATCH);
    await Promise.all(batch.map(async (pid) => {
      try {
        const vraw = await getMerchizeVariants(baseUrl, apiKey, pid);
        for (const v of extractMerchizeVariants(vraw)) {
          if (!v.sku || !v.title) continue;
          const res = await db.update(schema.skuMappings)
            .set({ variant: v.title.slice(0, 120) })
            .where(and(eq(schema.skuMappings.fulfillerId, ff.id), eq(schema.skuMappings.fulfillerSku, v.sku), emptyVariant))
            .returning({ id: schema.skuMappings.id });
          updated += res.length;
        }
        processed++;
      } catch { /* bỏ qua product lỗi, lần sau kéo lại */ }
    }));
  }

  const remaining = pids.length - processed;
  return NextResponse.json({ ok: true, productsTotal: pids.length, processed, updated, remaining, done: remaining <= 0 });
}
