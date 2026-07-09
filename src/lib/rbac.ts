import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import type { Session } from "@/lib/auth";
import type { Module } from "@/db/schema";

// Cache ma trận quyền 30s để không query mỗi request
let cache: { at: number; map: Map<string, number> } | null = null;

export async function permissionMap(): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.at < 30_000) return cache.map;
  const rows = await db.select().from(schema.rolePermissions);
  const map = new Map(rows.map((r) => [`${r.role}:${r.module}`, r.level]));
  cache = { at: Date.now(), map };
  return map;
}
export function invalidatePermissionCache() { cache = null; rcache = null; }

// Cache giới hạn theo role
let rcache: { at: number; map: Map<string, boolean> } | null = null;
async function roleRestrictionMap(): Promise<Map<string, boolean>> {
  if (rcache && Date.now() - rcache.at < 30_000) return rcache.map;
  const rows = await db.select().from(schema.roleRestrictions);
  const map = new Map(rows.filter((r) => r.enabled).map((r) => [`${r.role}:${r.restrictionKey}`, true]));
  rcache = { at: Date.now(), map };
  return map;
}

/** level của (role, module): 0 ẩn · 1 xem · 2 toàn quyền. Admin luôn 2. */
export async function levelOf(session: Session, module: Module): Promise<number> {
  if (session.role === "admin") return 2;
  const map = await permissionMap();
  return map.get(`${session.role}:${module}`) ?? 0;
}

export async function can(session: Session | null, module: Module, min: 1 | 2 = 1): Promise<boolean> {
  if (!session) return false;
  return (await levelOf(session, module)) >= min;
}

/**
 * Giới hạn dữ liệu có bật cho user không. Nhận Session (ưu tiên) để áp mặc định theo ROLE,
 * hoặc userId (string) — chỉ xét mức user. Admin không bao giờ bị giới hạn.
 * Hiệu lực = (mặc định theo role) HOẶC (override theo user).
 */
export async function hasRestriction(userOrSession: string | Session, key: string): Promise<boolean> {
  const sub = typeof userOrSession === "string" ? userOrSession : userOrSession.sub;
  const role = typeof userOrSession === "string" ? null : userOrSession.role;
  if (role === "admin") return false;
  if (role) {
    const rm = await roleRestrictionMap();
    if (rm.get(`${role}:${key}`)) return true;
  }
  const [r] = await db
    .select()
    .from(schema.userRestrictions)
    .where(and(eq(schema.userRestrictions.userId, sub), eq(schema.userRestrictions.restrictionKey, key)))
    .limit(1);
  return !!r?.enabled;
}
