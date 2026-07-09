import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { invalidatePermissionCache } from "@/lib/rbac";
import { MODULES, RESTRICTIONS } from "@/db/schema";

export const dynamic = "force-dynamic";
const ROLES = schema.rolePermissions.role.enumValues;

async function requireAdmin() {
  const s = await getSession();
  return s?.role === "admin" ? s : null;
}

// GET: toàn bộ ma trận quyền + giới hạn dữ liệu theo role
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false }, { status: 403 });
  const [permissions, roleRestrictions] = await Promise.all([
    db.select().from(schema.rolePermissions),
    db.select().from(schema.roleRestrictions),
  ]);
  return NextResponse.json({ ok: true, modules: MODULES, roles: ROLES, permissions, restrictions: RESTRICTIONS, roleRestrictions });
}

// PATCH: đổi 1 ô — module { role, module, level } HOẶC restriction { role, restriction, enabled }
export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || !ROLES.includes(b.role)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  if (b.role === "admin") return NextResponse.json({ ok: false, error: "admin luôn toàn quyền" }, { status: 400 });

  // Giới hạn dữ liệu theo role
  if (b.restriction !== undefined) {
    if (!RESTRICTIONS.includes(b.restriction) || typeof b.enabled !== "boolean") {
      return NextResponse.json({ ok: false, error: "invalid restriction" }, { status: 400 });
    }
    await db.insert(schema.roleRestrictions)
      .values({ role: b.role, restrictionKey: b.restriction, enabled: b.enabled })
      .onConflictDoUpdate({ target: [schema.roleRestrictions.role, schema.roleRestrictions.restrictionKey], set: { enabled: b.enabled } });
    invalidatePermissionCache();
    return NextResponse.json({ ok: true });
  }

  // Quyền module
  if (!MODULES.includes(b.module) || ![0, 1, 2].includes(b.level)) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  await db
    .insert(schema.rolePermissions)
    .values({ role: b.role, module: b.module, level: b.level })
    .onConflictDoUpdate({
      target: [schema.rolePermissions.role, schema.rolePermissions.module],
      set: { level: b.level },
    });
  invalidatePermissionCache();
  return NextResponse.json({ ok: true });
}
