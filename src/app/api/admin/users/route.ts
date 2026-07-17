import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { fileUrl } from "@/lib/storage";

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
      dateOfBirth: schema.users.dateOfBirth, startedAt: schema.users.startedAt, contractKey: schema.users.contractKey,
      avatarKey: schema.users.avatarKey, phone: schema.users.phone, telegramChatId: schema.users.telegramChatId,
    })
    .from(schema.users);
  return NextResponse.json({ ok: true, users: users.map((u) => ({ ...u, contractUrl: fileUrl(u.contractKey), avatarUrl: fileUrl(u.avatarKey) })) });
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
      .values({
        fullName: b.fullName, email: String(b.email).toLowerCase(), passwordHash, role: b.role, team: b.team, status: "active",
        dateOfBirth: (typeof b.dateOfBirth === "string" && b.dateOfBirth) ? b.dateOfBirth : null,
        startedAt: (typeof b.startedAt === "string" && b.startedAt) ? b.startedAt : null,
      })
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
  if (typeof b.telegramChatId === "string") patch.telegramChatId = b.telegramChatId.trim() || null;
  if (typeof b.fullName === "string" && b.fullName.trim()) patch.fullName = b.fullName.trim();
  if ("phone" in b) patch.phone = (typeof b.phone === "string" && b.phone.trim()) ? b.phone.trim().slice(0, 30) : null;
  if ("dateOfBirth" in b) patch.dateOfBirth = (typeof b.dateOfBirth === "string" && b.dateOfBirth) ? b.dateOfBirth : null;
  if ("startedAt" in b) patch.startedAt = (typeof b.startedAt === "string" && b.startedAt) ? b.startedAt : null;
  if ("contractKey" in b) patch.contractKey = (typeof b.contractKey === "string" && b.contractKey.trim()) ? b.contractKey.trim() : null;
  if (typeof b.email === "string" && b.email.trim()) {
    const em = b.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return NextResponse.json({ ok: false, error: "invalid email" }, { status: 400 });
    patch.email = em;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: "no changes" }, { status: 400 });

  try {
    await db.update(schema.users).set(patch).where(eq(schema.users.id, b.userId));
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/unique|duplicate/i.test(msg)) return NextResponse.json({ ok: false, error: "email already exists" }, { status: 409 });
    return NextResponse.json({ ok: false, error: "update failed" }, { status: 500 });
  }

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
    if (b.force === true) {
      // XOÁ CƯỠNG BỨC: gỡ mọi liên kết trước (giữ orders/designs, chỉ trống người phụ trách).
      // Bảng quyền (user_permissions/scopes/actions/sessions) đã cascade theo FK.
      const uid = b.userId;
      await db.execute(sql`UPDATE stores SET seller_id = NULL WHERE seller_id = ${uid}::uuid`);
      await db.execute(sql`UPDATE orders SET seller_id = NULL WHERE seller_id = ${uid}::uuid`);
      await db.execute(sql`UPDATE designs SET seller_id = NULL WHERE seller_id = ${uid}::uuid`);
      await db.execute(sql`UPDATE designs SET designer_id = NULL WHERE designer_id = ${uid}::uuid`);
      await db.execute(sql`UPDATE designs SET creator_id = NULL WHERE creator_id = ${uid}::uuid`);
      await db.execute(sql`UPDATE design_files SET uploaded_by = NULL WHERE uploaded_by = ${uid}::uuid`);
      await db.execute(sql`UPDATE order_issues SET reporter_id = NULL WHERE reporter_id = ${uid}::uuid`);
      await db.execute(sql`DELETE FROM design_reviews WHERE reviewer_id = ${uid}::uuid`); // reviewer NOT NULL → xoá review của user này
    }
    await db.delete(schema.users).where(eq(schema.users.id, b.userId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/foreign key|violates/i.test(msg)) {
      return NextResponse.json({ ok: false, linked: true, error: "This user is linked to designs/orders. Force-delete to unlink and remove." }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: msg.slice(0, 200) }, { status: 500 });
  }
}
