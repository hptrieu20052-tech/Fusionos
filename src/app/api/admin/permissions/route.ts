import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { invalidatePermissionCache } from "@/lib/rbac";
import { MODULES } from "@/db/schema";

export const dynamic = "force-dynamic";
const ROLES = schema.rolePermissions.role.enumValues;

async function requireAdmin() {
  const s = await getSession();
  return s?.role === "admin" ? s : null;
}

// GET: toàn bộ ma trận
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false }, { status: 403 });
  const rows = await db.select().from(schema.rolePermissions);
  return NextResponse.json({ ok: true, modules: MODULES, roles: ROLES, permissions: rows });
}

// PATCH: đổi 1 ô { role, module, level }
export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || !ROLES.includes(b.role) || !MODULES.includes(b.module) || ![0, 1, 2].includes(b.level)) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  if (b.role === "admin") return NextResponse.json({ ok: false, error: "admin luôn toàn quyền" }, { status: 400 });

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
