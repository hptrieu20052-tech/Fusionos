import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import type { Session } from "@/lib/auth";
import { hasRestriction } from "@/lib/rbac";

export type Scope = "all" | "team" | "own";
export type ScopeResource = "orders" | "designs" | "stores" | "dashboard" | "bookStudio";

let scache: { at: number; map: Map<string, Scope> } | null = null;
let uscache: { at: number; map: Map<string, Scope> } | null = null;
async function roleScopeMap(): Promise<Map<string, Scope>> {
  if (scache && Date.now() - scache.at < 30_000) return scache.map;
  const rows = await db.select().from(schema.roleDataScopes).catch(() => [] as { role: string; resource: string; scope: string }[]);
  const map = new Map(rows.map((r) => [`${r.role}:${r.resource}`, r.scope as Scope]));
  scache = { at: Date.now(), map };
  return map;
}
async function userScopeMap(): Promise<Map<string, Scope>> {
  if (uscache && Date.now() - uscache.at < 30_000) return uscache.map;
  const rows = await db.select().from(schema.userDataScopes).catch(() => [] as { userId: string; resource: string; scope: string }[]);
  const map = new Map(rows.map((r) => [`${r.userId}:${r.resource}`, r.scope as Scope]));
  uscache = { at: Date.now(), map };
  return map;
}
export function invalidateScopeCache() { scache = null; uscache = null; }

/** Phạm vi dữ liệu của user với 1 resource. Override user → mặc định role → suy từ restriction cũ → all. Admin=all. */
export async function resolveScope(session: Session, resource: ScopeResource): Promise<Scope> {
  if (session.role === "admin") return "all";
  const uv = (await userScopeMap()).get(`${session.sub}:${resource}`);
  if (uv) return uv;
  const s = (await roleScopeMap()).get(`${session.role}:${resource}`);
  if (s) return s;
  // Fallback tương thích cũ: có own_* restriction → own (chỉ orders/designs mới có key cũ)
  if (resource === "orders" && (await hasRestriction(session, "own_orders_only"))) return "own";
  if (resource === "designs" && (await hasRestriction(session, "own_designs_only"))) return "own";
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

/**
 * Store-owner ids cho phạm vi Products (và bất kỳ dữ liệu gắn theo store).
 * SÀN AN TOÀN: role `seller` LUÔN bị giới hạn own store — kể cả khi chưa seed scope `stores`
 * (SEED_permissions.sql chỉ seed orders/designs/dashboard). Admin & role khác giữ nguyên scope thật (own/team/all).
 * Trả null = không giới hạn (thấy mọi store).
 */
export async function storeOwnerScopeIds(session: Session): Promise<string[] | null> {
  const ids = await scopeOwnerIds(session, "stores");
  if (ids) return ids;                                    // đã có giới hạn own/team theo cấu hình
  if (session.role === "seller") return [session.sub];    // seller chưa cấu hình → CHỈ store mình
  return null;                                            // admin / role khác → all
}

/** Chủ sở hữu ownerId có nằm trong phạm vi của user không (dùng cho check quyền theo từng đơn/design). */
export async function inScope(session: Session, resource: ScopeResource, ownerId: string | null | undefined): Promise<boolean> {
  const ids = await scopeOwnerIds(session, resource);
  if (!ids) return true; // all
  return !!ownerId && ids.includes(ownerId);
}
