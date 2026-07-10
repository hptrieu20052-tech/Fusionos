import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
const adminOnly = async () => { const s = await getSession(); return s?.role === "admin" ? s : null; };

// GET: danh sách team (kể cả rỗng) + thành viên
export async function GET() {
  if (!(await adminOnly())) return NextResponse.json({ ok: false }, { status: 403 });
  const teams = await db.select().from(schema.teams).orderBy(schema.teams.name);
  const users = await db.select({ id: schema.users.id, fullName: schema.users.fullName, role: schema.users.role, team: schema.users.team }).from(schema.users);
  const out = teams.map((tm) => ({
    id: tm.id, name: tm.name,
    members: users.filter((u) => u.team === tm.name).map((u) => ({ id: u.id, fullName: u.fullName, role: u.role })),
  }));
  return NextResponse.json({ ok: true, teams: out, allUsers: users });
}

// POST { name } — tạo team mới (rỗng)
export async function POST(req: NextRequest) {
  if (!(await adminOnly())) return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  const name = String(b?.name ?? "").trim();
  if (!name) return NextResponse.json({ ok: false, error: "Missing team name" }, { status: 400 });
  try {
    const [t] = await db.insert(schema.teams).values({ name }).returning();
    return NextResponse.json({ ok: true, id: t.id, name: t.name });
  } catch {
    return NextResponse.json({ ok: false, error: "Team name already exists" }, { status: 409 });
  }
}

// PATCH { id, name } — đổi tên team (đồng bộ luôn users.team)
export async function PATCH(req: NextRequest) {
  if (!(await adminOnly())) return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  const name = String(b?.name ?? "").trim();
  if (!b?.id || !name) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  const [old] = await db.select().from(schema.teams).where(eq(schema.teams.id, b.id)).limit(1);
  if (!old) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    await db.update(schema.teams).set({ name }).where(eq(schema.teams.id, b.id));
    await db.update(schema.users).set({ team: name }).where(eq(schema.users.team, old.name));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Team name already exists" }, { status: 409 });
  }
}

// DELETE { id } — xóa team + gỡ thành viên khỏi team
export async function DELETE(req: NextRequest) {
  if (!(await adminOnly())) return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  const [old] = await db.select().from(schema.teams).where(eq(schema.teams.id, b.id)).limit(1);
  if (!old) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  await db.update(schema.users).set({ team: null }).where(eq(schema.users.team, old.name));
  await db.delete(schema.teams).where(eq(schema.teams.id, b.id));
  return NextResponse.json({ ok: true });
}
