import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import type { Session } from "@/lib/auth";
import { hasRestriction } from "@/lib/rbac";

export type Scope = "all" | "team" | "own";
export type ScopeResource = "orders" | "designs";

let scache: { at: number; map: Map<string, Scope> } | null = null;
async function roleScopeMap(): Promise<Map<string, Scope>> {
  if (scache && Date.now() - scache.at < 30_000) return scache.map;
  const rows = await db.select().from(schema.roleDataScopes).catch(() => [] as { role: string; resource: string; scope: string }[]);
  const map = new Map(rows.map((r) => [`${r.role}:${r.resource}`, r.scope as Scope]));
  scache = { at: Date.now(), map };
  return map;
}
export function invalidateScopeCache() { scache = null; }

/** Phạm vi dữ liệu của user với 1 resource. Admin = all. Nếu chưa cấu hình → suy từ restriction own_* (own) else all. */
export async function resolveScope(session: Session, resource: ScopeResource): Promise<Scope> {
  if (session.role === "admin") return "all";
  const map = await roleScopeMap();
  const s = map.get(`${session.role}:${resource}`);
  if (s) return s;
  // Fallback tương thích cũ: có own_* restriction → own
  const legacyKey = resource === "orders" ? "own_orders_only" : "own_designs_only";
  if (await hasRestriction(session, legacyKey)) return "own";
  return "all";
}

/**
 * Danh sách user id được phép (theo chủ sở hữu dữ liệu). null = không giới hạn (all).
 * own → [chính mình]; team → mọi thành viên cùng team.
 */
export async function scopeOwnerIds(session: Session, resource: ScopeResource): Promise<string[] | null> {
  const scope = await resolveScope(session, resource);
  if (scope === "all") return null;
  if (scope === "own") return [session.sub];
  const [me] = await db.select({ team: schema.users.team }).from(schema.users).where(eq(schema.users.id, session.sub)).limit(1);
  if (!me?.team) return [session.sub];
  const members = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.team, me.team));
  return members.map((m) => m.id);
}

/** Chủ sở hữu ownerId có nằm trong phạm vi của user không (dùng cho check quyền theo từng đơn/design). */
export async function inScope(session: Session, resource: ScopeResource, ownerId: string | null | undefined): Promise<boolean> {
  const ids = await scopeOwnerIds(session, resource);
  if (!ids) return true; // all
  return !!ownerId && ids.includes(ownerId);
}
