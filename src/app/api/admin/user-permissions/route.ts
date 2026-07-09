import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { invalidatePermissionCache } from "@/lib/rbac";
import { invalidateScopeCache } from "@/lib/scope";
import { invalidateActionCache } from "@/lib/actions";
import { MODULES, RESTRICTIONS, SCOPES, SCOPE_RESOURCES, ACTIONS } from "@/db/schema";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const s = await getSession();
  return s?.role === "admin" ? s : null;
}

// GET: mọi thứ để dựng UI per-user (role mặc định + override user)
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false }, { status: 403 });
  const [users, rolePerms, roleRestr, roleScopes, roleActs, uPerms, uRestr, uScopes, uActs] = await Promise.all([
    db.select({ id: schema.users.id, fullName: schema.users.fullName, email: schema.users.email, role: schema.users.role, team: schema.users.team }).from(schema.users),
    db.select().from(schema.rolePermissions).catch(() => []),
    db.select().from(schema.roleRestrictions).catch(() => []),
    db.select().from(schema.roleDataScopes).catch(() => []),
    db.select().from(schema.roleActions).catch(() => []),
    db.select().from(schema.userPermissions).catch(() => []),
    db.select().from(schema.userRestrictions).catch(() => []),
    db.select().from(schema.userDataScopes).catch(() => []),
    db.select().from(schema.userActions).catch(() => []),
  ]);
  return NextResponse.json({
    ok: true,
    users, modules: MODULES, restrictions: RESTRICTIONS, scopes: SCOPES, scopeResources: SCOPE_RESOURCES, actions: ACTIONS,
    rolePerms, roleRestr, roleScopes, roleActs, uPerms, uRestr, uScopes, uActs,
  });
}

// PATCH: đổi 1 ô override theo user.
// { userId, kind: "module"|"restriction"|"scope"|"action", key, value, reset? }
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.userId || !b?.kind) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  // Không cho tự khóa chính mình khỏi admin (an toàn)
  const [u] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, b.userId)).limit(1);
  if (!u) return NextResponse.json({ ok: false, error: "user not found" }, { status: 404 });
  if (u.role === "admin") return NextResponse.json({ ok: false, error: "admin luôn toàn quyền" }, { status: 400 });

  try {
    if (b.kind === "module") {
      if (!MODULES.includes(b.key) || ![0, 1, 2].includes(b.value)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
      if (b.reset) await db.delete(schema.userPermissions).where(and(eq(schema.userPermissions.userId, b.userId), eq(schema.userPermissions.module, b.key)));
      else await db.insert(schema.userPermissions).values({ userId: b.userId, module: b.key, level: b.value })
        .onConflictDoUpdate({ target: [schema.userPermissions.userId, schema.userPermissions.module], set: { level: b.value } });
      invalidatePermissionCache();
    } else if (b.kind === "restriction") {
      if (!RESTRICTIONS.includes(b.key) || typeof b.value !== "boolean") return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
      if (b.reset) await db.delete(schema.userRestrictions).where(and(eq(schema.userRestrictions.userId, b.userId), eq(schema.userRestrictions.restrictionKey, b.key)));
      else await db.insert(schema.userRestrictions).values({ userId: b.userId, restrictionKey: b.key, enabled: b.value })
        .onConflictDoUpdate({ target: [schema.userRestrictions.userId, schema.userRestrictions.restrictionKey], set: { enabled: b.value } });
      invalidatePermissionCache();
    } else if (b.kind === "scope") {
      if (!SCOPE_RESOURCES.includes(b.key) || !SCOPES.includes(b.value)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
      if (b.reset) await db.delete(schema.userDataScopes).where(and(eq(schema.userDataScopes.userId, b.userId), eq(schema.userDataScopes.resource, b.key)));
      else await db.insert(schema.userDataScopes).values({ userId: b.userId, resource: b.key, scope: b.value })
        .onConflictDoUpdate({ target: [schema.userDataScopes.userId, schema.userDataScopes.resource], set: { scope: b.value } });
      invalidateScopeCache();
    } else if (b.kind === "action") {
      if (!ACTIONS.some((a) => a.key === b.key) || typeof b.value !== "boolean") return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
      if (b.reset) await db.delete(schema.userActions).where(and(eq(schema.userActions.userId, b.userId), eq(schema.userActions.actionKey, b.key)));
      else await db.insert(schema.userActions).values({ userId: b.userId, actionKey: b.key, enabled: b.value })
        .onConflictDoUpdate({ target: [schema.userActions.userId, schema.userActions.actionKey], set: { enabled: b.value } });
      invalidateActionCache();
    } else return NextResponse.json({ ok: false, error: "invalid kind" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
