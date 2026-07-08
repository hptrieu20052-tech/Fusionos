import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf, hasRestriction } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// PATCH /api/order-items/[id] — body: { skuCode?: number|null, specialPrint?: boolean }
// skuCode = mã số tuần tự của design trong Design Studio; null = bỏ gán
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const item = (await db.execute(sql`
    SELECT i.id, i.order_id, o.seller_id FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = ${params.id}::uuid
  `)).rows[0] as { id: string; order_id: string; seller_id: string | null } | undefined;
  if (!item) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if ((await hasRestriction(session.sub, "own_orders_only")) && item.seller_id !== session.sub) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  type D = { id: string; sku_code: number; title: string };
  let design: D | null = null;
  if ("skuCode" in b) {
    if (b.skuCode === null || b.skuCode === "") {
      await db.update(schema.orderItems).set({ designId: null }).where(eq(schema.orderItems.id, params.id));
    } else {
      const sku = Number(b.skuCode);
      if (!Number.isInteger(sku) || sku <= 0) return NextResponse.json({ ok: false, error: "Design ID phải là số" }, { status: 400 });
      design = (await db.execute(sql`SELECT id, sku_code, title FROM designs WHERE sku_code = ${sku}`)).rows[0] as unknown as D | undefined ?? null;
      if (!design) return NextResponse.json({ ok: false, error: `Không tìm thấy design #${sku}` }, { status: 404 });
      await db.update(schema.orderItems).set({ designId: design.id }).where(eq(schema.orderItems.id, params.id));
    }
  }
  if ("personalization" in b) {
    await db.update(schema.orderItems).set({ personalization: String(b.personalization ?? "").trim() || null }).where(eq(schema.orderItems.id, params.id));
  }
  if ("specialPrint" in b) {
    await db.update(schema.orderItems).set({ specialPrint: !!b.specialPrint }).where(eq(schema.orderItems.id, params.id));
  }
  if ("mockupKey" in b) {
    const key = (typeof b.mockupKey === "string" && b.mockupKey.trim()) ? b.mockupKey.trim() : null;
    await db.update(schema.orderItems).set({ mockupKey: key }).where(eq(schema.orderItems.id, params.id));
  }
  return NextResponse.json({ ok: true, design });
}
