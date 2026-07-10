import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { invalidatePermissionCache } from "@/lib/rbac";
import { invalidateScopeCache } from "@/lib/scope";
import { invalidateActionCache } from "@/lib/actions";
import { MODULES, RESTRICTIONS, SCOPES, SCOPE_RESOURCES, ACTIONS } from "@/db/schema";

export const dynamic = "force-dynamic";
const ROLES = schema.rolePermissions.role.enumValues;

async function requireAdmin() {
  const s = await getSession();
  return s?.role === "admin" ? s : null;
}

// GET: ma trận quyền + giới hạn + phạm vi + hành động
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false }, { status: 403 });
  const [permissions, roleRestrictions, dataScopes, roleActions] = await Promise.all([
    db.select().from(schema.rolePermissions),
    db.select().from(schema.roleRestrictions).catch(() => []),
    db.select().from(schema.roleDataScopes).catch(() => []),
    db.select().from(schema.roleActions).catch(() => []),
  ]);
  return NextResponse.json({ ok: true, modules: MODULES, roles: ROLES, permissions, restrictions: RESTRICTIONS, roleRestrictions, scopes: SCOPES, scopeResources: SCOPE_RESOURCES, dataScopes, actions: ACTIONS, roleActions });
}

// PATCH: module{role,module,level} · restriction{role,restriction,enabled} · scope{role,resource,scope} · action{role,action,enabled}
export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || !ROLES.includes(b.role)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  if (b.role === "admin") return NextResponse.json({ ok: false, error: "admin always has full access" }, { status: 400 });

  // Hành động chi tiết
  if (b.action !== undefined) {
    if (!ACTIONS.some((a) => a.key === b.action) || typeof b.enabled !== "boolean") {
      return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
    }
    await db.insert(schema.roleActions)
      .values({ role: b.role, actionKey: b.action, enabled: b.enabled })
      .onConflictDoUpdate({ target: [schema.roleActions.role, schema.roleActions.actionKey], set: { enabled: b.enabled } });
    invalidateActionCache();
    return NextResponse.json({ ok: true });
  }

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
