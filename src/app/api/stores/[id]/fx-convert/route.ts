import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { hasAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

/**
 * POST /api/stores/[id]/fx-convert — quy đổi 1 LẦN các đơn ĐÃ import (đang lưu số tiền gốc)
 * sang USD bằng cách chia total/phí/đơn giá cho fx_rate của shop. Ghi mốc để cảnh báo chạy lại.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (await levelOf(session, "stores")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!(await hasAction(session, "stores.fx"))) return NextResponse.json({ ok: false, error: "forbidden: fx" }, { status: 403 });

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, params.id)).limit(1);
  if (!store) return NextResponse.json({ ok: false, error: "store không tồn tại" }, { status: 404 });
  const rate = Number(store.fxRate ?? 1);
  if (!(rate > 1)) return NextResponse.json({ ok: false, error: "Tỉ giá phải > 1 (vd VND ≈ 25400) — set ở form store trước." }, { status: 400 });

  // Chia total + platform_fee của đơn, và unit_price của item, cho tỉ giá → USD
  const res = await db.execute(sql`
    UPDATE orders
    SET total = round(total / ${rate}, 2),
        platform_fee = round(platform_fee / ${rate}, 2),
        currency = 'USD',
        updated_at = now()
    WHERE store_id = ${params.id}
  `);
  await db.execute(sql`
    UPDATE order_items SET unit_price = round(unit_price / ${rate}, 2)
    WHERE order_id IN (SELECT id FROM orders WHERE store_id = ${params.id})
  `);

  const convertedAt = new Date().toISOString();
  const health = { ...((store.health as Record<string, unknown>) ?? {}), fxConvertedAt: convertedAt, fxConvertedRate: rate };
  await db.update(schema.stores).set({ health }).where(eq(schema.stores.id, params.id));

  return NextResponse.json({ ok: true, orders: (res as { rowCount?: number }).rowCount ?? 0, rate, convertedAt });
}
