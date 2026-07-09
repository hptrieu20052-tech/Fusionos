import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { invalidatePermissionCache } from "@/lib/rbac";
import { invalidateScopeCache } from "@/lib/scope";
import { MODULES, RESTRICTIONS, SCOPES, SCOPE_RESOURCES } from "@/db/schema";

export const dynamic = "force-dynamic";
const ROLES = schema.rolePermissions.role.enumValues;

async function requireAdmin() {
  const s = await getSession();
  return s?.role === "admin" ? s : null;
}

// GET: ma trận quyền + giới hạn dữ liệu + phạm vi (all/team/own)
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false }, { status: 403 });
  const [permissions, roleRestrictions, dataScopes] = await Promise.all([
    db.select().from(schema.rolePermissions),
    db.select().from(schema.roleRestrictions).catch(() => []),
    db.select().from(schema.roleDataScopes).catch(() => []),
  ]);
  return NextResponse.json({ ok: true, modules: MODULES, roles: ROLES, permissions, restrictions: RESTRICTIONS, roleRestrictions, scopes: SCOPES, scopeResources: SCOPE_RESOURCES, dataScopes });
}

// PATCH: module { role, module, level } · restriction { role, restriction, enabled } · scope { role, resource, scope }
export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || !ROLES.includes(b.role)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  if (b.role === "admin") return NextResponse.json({ ok: false, error: "admin luôn toàn quyền" }, { status: 400 });

  // Phạm vi dữ liệu theo role
  if (b.resource !== undefined && b.scope !== undefined) {
    if (!SCOPE_RESOURCES.includes(b.resource) || !SCOPES.includes(b.scope)) {
      return NextResponse.json({ ok: false, error: "invalid scope" }, { status: 400 });
    }
    await db.insert(schema.roleDataScopes)
      .values({ role: b.role, resource: b.resource, scope: b.scope })
      .onConflictDoUpdate({ target: [schema.roleDataScopes.role, schema.roleDataScopes.resource], set: { scope: b.scope } });
    invalidateScopeCache();
    return NextResponse.json({ ok: true });
  }

  // Giới hạn dữ liệu theo role
  if (b.restriction !== undefined) {
    if (!RESTRICTIONS.includes(b.restriction) || typeof b.enabled !== "boolean") {
      return NextResponse.json({ ok: false, error: "invalid restriction" }, { status: 400 });
    }
    await db.insert(schema.roleRestrictions)
      .values({ role: b.role, restrictionKey: b.restriction, enabled: b.enabled })
      .onConflictDoUpdate({ target: [schema.roleRestrictions.role, schema.roleRestrictions.restrictionKey], set: { enabled: b.enabled } });
    invalidatePermissionCache();
    invalidateScopeCache();
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
