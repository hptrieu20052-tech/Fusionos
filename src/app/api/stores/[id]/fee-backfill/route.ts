import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { normFeePct } from "@/lib/fee";

export const dynamic = "force-dynamic";

/**
 * POST /api/stores/[id]/fee-backfill — tính PHÍ SÀN ƯỚC TÍNH cho các đơn CŨ đang FEE = 0.
 *
 * Vì sao cần: API đơn của Etsy/TikTok không kèm phí sàn (phí chỉ có khi sàn quyết toán),
 * nên mọi đơn kéo về trước khi có tính năng này đều đang lưu platform_fee = 0 → lợi nhuận ảo.
 *
 * An toàn: CHỈ đụng đơn có platform_fee = 0 của đúng shop này. Đơn đã có phí (kể cả phí thật
 * từ file Payments của Etsy) KHÔNG bị ghi đè.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (await levelOf(session, "stores")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, params.id)).limit(1);
  if (!store) return NextResponse.json({ ok: false, error: "store doesn't exist" }, { status: 404 });

  const pct = normFeePct(store.feeRate);
  if (!pct) return NextResponse.json({ ok: false, error: "Set an estimated fee % (0–99) on this store first." }, { status: 400 });

  const res = await db.execute(sql`
    UPDATE orders
    SET platform_fee = round(total * ${pct} / 100.0, 2),
        fee_estimated = true,
        updated_at = now()
    WHERE store_id = ${params.id} AND coalesce(platform_fee, 0) = 0 AND coalesce(total, 0) > 0
  `);

  const backfilledAt = new Date().toISOString();
  const health = { ...((store.health as Record<string, unknown>) ?? {}), feeBackfilledAt: backfilledAt, feeBackfilledPct: pct };
  await db.update(schema.stores).set({ health }).where(eq(schema.stores.id, params.id));

  return NextResponse.json({ ok: true, orders: (res as { rowCount?: number }).rowCount ?? 0, pct, backfilledAt });
}
