import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
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
    return NextResponse.json({ ok: false, error: "email already exists" }, { status: 409 });
  }
}

// PATCH: reset mật khẩu / khóa-mở / đổi role / đổi team
export async function PATCH(req: NextRequest) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.userId) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof b.password === "string" && b.password) patch.passwordHash = await bcrypt.hash(String(b.password), 10);
  if (b.status === "active" || b.status === "disabled") {
    if (b.status === "disabled" && b.userId === s.sub) return NextResponse.json({ ok: false, error: "You can't lock your own account" }, { status: 400 });
    patch.status = b.status;
  }
  if (typeof b.role === "string" && schema.users.role.enumValues.includes(b.role)) patch.role = b.role;
  if (typeof b.team === "string") patch.team = b.team.trim() || null;
  if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: "no changes" }, { status: 400 });

  await db.update(schema.users).set(patch).where(eq(schema.users.id, b.userId));

  // Nếu chuyển role sang seller → tự thêm restriction own_orders_only
  if (patch.role === "seller") {
    await db.insert(schema.userRestrictions).values([{ userId: b.userId, restrictionKey: "own_orders_only" }]).onConflictDoNothing();
  }
  return NextResponse.json({ ok: true });
}

// DELETE: xóa hẳn user (nếu còn ràng buộc dữ liệu → gợi ý khóa thay vì xóa)
export async function DELETE(req: NextRequest) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.userId) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  if (b.userId === s.sub) return NextResponse.json({ ok: false, error: "You can't delete yourself" }, { status: 400 });
  const admins = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.role, "admin"));
  if (admins.length <= 1 && admins.some((a) => a.id === b.userId)) {
    return NextResponse.json({ ok: false, error: "Can't delete the last admin" }, { status: 400 });
  }
  try {
    await db.delete(schema.users).where(eq(schema.users.id, b.userId));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "This user is linked to designs/orders — LOCK instead of deleting to keep history." }, { status: 409 });
  }
}
