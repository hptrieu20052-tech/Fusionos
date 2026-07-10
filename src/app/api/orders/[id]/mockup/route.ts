import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// POST /api/orders/[id]/mockup { key } — gán ảnh mockup (đã upload R2) cho MỌI item của đơn.
// Dùng cho đơn import CSV chưa có mockup, để đẩy nhà in (Merchize) có image hợp lệ.
// DELETE — gỡ mockup khỏi mọi item.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (await levelOf(session, "orders")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const key = typeof b?.key === "string" && b.key.trim() ? b.key.trim() : null;
  if (!key) return NextResponse.json({ ok: false, error: "missing key" }, { status: 400 });
  await db.update(schema.orderItems).set({ mockupKey: key }).where(eq(schema.orderItems.orderId, params.id));
  return NextResponse.json({ ok: true, key });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (await levelOf(session, "orders")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  await db.update(schema.orderItems).set({ mockupKey: null }).where(eq(schema.orderItems.orderId, params.id));
  return NextResponse.json({ ok: true });
}
