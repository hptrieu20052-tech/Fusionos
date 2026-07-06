import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

// GET: danh sách user (admin) · POST: tạo user mới (admin)
export async function GET() {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false }, { status: 403 });
  const users = await db
    .select({
      id: schema.users.id, fullName: schema.users.fullName, email: schema.users.email,
      role: schema.users.role, team: schema.users.team, status: schema.users.status,
      lastActiveAt: schema.users.lastActiveAt,
    })
    .from(schema.users);
  return NextResponse.json({ ok: true, users });
}

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fullName || !b?.email || !b?.password || !schema.users.role.enumValues.includes(b.role)) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const passwordHash = await bcrypt.hash(String(b.password), 10);
  try {
    const [u] = await db
      .insert(schema.users)
      .values({ fullName: b.fullName, email: String(b.email).toLowerCase(), passwordHash, role: b.role, team: b.team, status: "active" })
      .returning({ id: schema.users.id });
    // restriction mặc định cho seller
    if (b.role === "seller") {
      await db.insert(schema.userRestrictions).values([
        { userId: u.id, restrictionKey: "own_orders_only" },
        { userId: u.id, restrictionKey: "hide_profit" },
      ]).onConflictDoNothing();
    }
    return NextResponse.json({ ok: true, id: u.id });
  } catch {
    return NextResponse.json({ ok: false, error: "email đã tồn tại" }, { status: 409 });
  }
}
