import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { inScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

// POST /api/orders/[id]/mark-delivered — SELLER (và admin/support) tự chốt đơn ĐÃ GIAO.
// Điều kiện cứng: đơn PHẢI có tracking (ít nhất 1 bản ghi fulfill có mã vận chuyển) — không cho
// chốt Delivered chay; và đơn chưa ở trạng thái kết thúc (delivered/cancel/trash).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const o = (await db.execute(sql`SELECT id, status, seller_id FROM orders WHERE id = ${params.id}::uuid`)).rows[0] as
    { id: string; status: string; seller_id: string | null } | undefined;
  if (!o) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (!(await inScope(session, "orders", o.seller_id))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  if (["delivered", "cancel", "trash"].includes(o.status)) {
    return NextResponse.json({ ok: false, error: `order is already ${o.status}` }, { status: 409 });
  }
  const [trk] = (await db.execute(sql`
    SELECT 1 FROM fulfillment_orders WHERE order_id = ${params.id}::uuid AND tracking_number IS NOT NULL LIMIT 1
  `)).rows;
  if (!trk) return NextResponse.json({ ok: false, error: "order has no tracking yet — only tracked orders can be marked delivered" }, { status: 400 });

  await db.execute(sql`UPDATE orders SET status = 'delivered', updated_at = NOW() WHERE id = ${params.id}::uuid`);
  return NextResponse.json({ ok: true });
}
