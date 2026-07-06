import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// POST — thêm chi phí/thu thủ công (ads, lương, tool, sample…)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "finance")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b || !schema.transactions.type.enumValues.includes(b.type) || !b.amount || isNaN(Number(b.amount))) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const amount = Number(b.amount);
  // Quy ước: revenue dương, mọi chi phí âm — tự đổi dấu nếu người nhập quên
  const signed = b.type === "revenue" ? Math.abs(amount) : -Math.abs(amount);
  const [t] = await db.insert(schema.transactions).values({
    type: b.type, amount: signed.toFixed(2), note: b.note,
    occurredAt: b.occurredAt ?? new Date().toISOString().slice(0, 10),
  }).returning();
  return NextResponse.json({ ok: true, transaction: t });
}
