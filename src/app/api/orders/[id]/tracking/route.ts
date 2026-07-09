import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { hasAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders/[id]/tracking
 * Nhập tay tracking / carrier / link / base cost / ship fee cho đơn.
 * - Có ffOrder rồi → cập nhật (theo fulfillerId nếu truyền, else bản đầu tiên).
 * - Chưa có ffOrder → tạo mới (cần fulfillerId).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "fulfillment")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!(await hasAction(session, "orders.manual_cost"))) return NextResponse.json({ ok: false, error: "forbidden: manual cost" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  const num = (v: unknown) => (v === "" || v == null ? null : (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : null));
  const patch = {
    trackingNumber: (b.trackingNumber ?? "").trim() || null,
    trackingCarrier: (b.trackingCarrier ?? "").trim() || null,
    trackingUrl: (b.trackingUrl ?? "").trim() || null,
    supplierOrderUrl: (b.supplierOrderUrl ?? "").trim() || null,
    baseCost: num(b.baseCost),
    shipCost: num(b.shipCost),
  };

  const existing = await db.select().from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.orderId, params.id));
  let ffo = b.fulfillerId ? existing.find((x) => x.fulfillerId === b.fulfillerId) : existing[0];

  if (ffo) {
    const cost = patch.baseCost != null || patch.shipCost != null
      ? (Number(patch.baseCost ?? ffo.baseCost ?? 0) + Number(patch.shipCost ?? ffo.shipCost ?? 0)).toFixed(2)
      : ffo.cost;
    await db.update(schema.fulfillmentOrders).set({
      ...patch,
      baseCost: patch.baseCost ?? ffo.baseCost,
      shipCost: patch.shipCost ?? ffo.shipCost,
      cost,
      trackingSyncedAt: patch.trackingNumber ? new Date() : ffo.trackingSyncedAt,
    }).where(eq(schema.fulfillmentOrders.id, ffo.id));
    return NextResponse.json({ ok: true, id: ffo.id, updated: true });
  }

  // Tạo mới — cần chọn nhà fulfill
  if (!b.fulfillerId) return NextResponse.json({ ok: false, error: "Chọn nhà cung cấp (Fulfilled by) trước khi nhập tay" }, { status: 400 });
  const cost = (Number(patch.baseCost ?? 0) + Number(patch.shipCost ?? 0)).toFixed(2);
  const [row] = await db.insert(schema.fulfillmentOrders).values({
    orderId: params.id, fulfillerId: b.fulfillerId,
    status: "pushed", externalFfId: `MANUAL-${Date.now()}`,
    ...patch, cost, pushedAt: new Date(),
    trackingSyncedAt: patch.trackingNumber ? new Date() : null,
  }).returning();
  return NextResponse.json({ ok: true, id: row.id, created: true });
}

// DELETE — xóa bản ghi fulfillment (gỡ tracking/chi phí nhập nhầm)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "fulfillment")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.ffOrderId) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  await db.delete(schema.fulfillmentOrders).where(and(eq(schema.fulfillmentOrders.id, b.ffOrderId), eq(schema.fulfillmentOrders.orderId, params.id)));
  return NextResponse.json({ ok: true });
}
