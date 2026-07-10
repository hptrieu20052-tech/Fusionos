import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

// GET /api/order-issues — danh sách issue + tổng hợp theo supplier
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const rows = (await db.execute(sql`
    SELECT i.id, i.reason, i.image_key, i.created_at,
           o.external_id, o.id AS order_id,
           f.name AS supplier, f.id AS supplier_id,
           u.full_name AS reporter
    FROM order_issues i
    JOIN orders o ON o.id = i.order_id
    LEFT JOIN fulfillers f ON f.id = i.fulfiller_id
    LEFT JOIN users u ON u.id = i.reporter_id
    ORDER BY i.created_at DESC
    LIMIT 300
  `)).rows as Record<string, unknown>[];

  const issues = rows.map((r) => ({
    id: r.id, reason: r.reason, createdAt: r.created_at,
    externalId: r.external_id, orderId: r.order_id,
    supplier: r.supplier ?? "—", supplierId: r.supplier_id,
    reporter: r.reporter ?? "—",
    imageUrl: fileUrl(r.image_key as string | null),
  }));

  // Tổng hợp theo supplier
  const bySupplier: Record<string, { supplier: string; count: number }> = {};
  for (const i of issues) {
    const key = String(i.supplier);
    (bySupplier[key] ??= { supplier: key, count: 0 }).count++;
  }
  const report = Object.values(bySupplier).sort((a, b) => b.count - a.count);

  return NextResponse.json({ ok: true, issues, report, total: issues.length });
}

// POST /api/order-issues { orderId, fulfillerId?, reason, imageKey? }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.orderId || !b?.reason?.trim()) return NextResponse.json({ ok: false, error: "Missing order or reason" }, { status: 400 });

  const [row] = await db.insert(schema.orderIssues).values({
    orderId: b.orderId,
    fulfillerId: b.fulfillerId || null,
    reason: String(b.reason).trim().slice(0, 2000),
    imageKey: b.imageKey || null,
    reporterId: session.sub,
  }).returning();

  // Đánh dấu đơn có vấn đề
  await db.update(schema.orders).set({ status: "has_issues", updatedAt: new Date() }).where(eq(schema.orders.id, b.orderId));

  return NextResponse.json({ ok: true, id: row.id });
}
