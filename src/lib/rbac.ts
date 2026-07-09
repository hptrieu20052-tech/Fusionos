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
export function invalidatePermissionCache() { cache = null; rcache = null; upcache = null; urcache = null; }

// Cache override quyền module theo USER (tất cả dòng, nhẹ)
let upcache: { at: number; map: Map<string, number> } | null = null;
async function userPermissionMap(): Promise<Map<string, number>> {
  if (upcache && Date.now() - upcache.at < 30_000) return upcache.map;
  const rows = await db.select().from(schema.userPermissions).catch(() => [] as { userId: string; module: string; level: number }[]);
  const map = new Map(rows.map((r) => [`${r.userId}:${r.module}`, r.level]));
  upcache = { at: Date.now(), map };
  return map;
}

// Cache override giới hạn theo USER (có bản ghi = ghi đè role)
let urcache: { at: number; map: Map<string, boolean> } | null = null;
async function userRestrictionMap(): Promise<Map<string, boolean>> {
  if (urcache && Date.now() - urcache.at < 30_000) return urcache.map;
  const rows = await db.select().from(schema.userRestrictions).catch(() => [] as { userId: string; restrictionKey: string; enabled: boolean }[]);
  const map = new Map(rows.map((r) => [`${r.userId}:${r.restrictionKey}`, r.enabled]));
  urcache = { at: Date.now(), map };
  return map;
}

// Cache giới hạn theo role
let rcache: { at: number; map: Map<string, boolean> } | null = null;
async function roleRestrictionMap(): Promise<Map<string, boolean>> {
  if (rcache && Date.now() - rcache.at < 30_000) return rcache.map;
  const rows = await db.select().from(schema.roleRestrictions).catch(() => [] as { role: string; restrictionKey: string; enabled: boolean }[]);
  const map = new Map(rows.filter((r) => r.enabled).map((r) => [`${r.role}:${r.restrictionKey}`, true]));
  rcache = { at: Date.now(), map };
  return map;
}

/** level của (user/role, module): override user → mặc định role → 0. Admin luôn 2. */
export async function levelOf(session: Session, module: Module): Promise<number> {
  if (session.role === "admin") return 2;
  const um = await userPermissionMap();
  const uv = um.get(`${session.sub}:${module}`);
  if (uv !== undefined) return uv;
  const map = await permissionMap();
  return map.get(`${session.role}:${module}`) ?? 0;
}

export async function can(session: Session | null, module: Module, min: 1 | 2 = 1): Promise<boolean> {
  if (!session) return false;
  return (await levelOf(session, module)) >= min;
}

/**
 * Giới hạn dữ liệu có bật cho user không. Ưu tiên override THEO USER, rồi mặc định THEO ROLE.
 * Admin không bao giờ bị giới hạn.
 */
export async function hasRestriction(userOrSession: string | Session, key: string): Promise<boolean> {
  const sub = typeof userOrSession === "string" ? userOrSession : userOrSession.sub;
  const role = typeof userOrSession === "string" ? null : userOrSession.role;
  if (role === "admin") return false;
  const um = await userRestrictionMap();
  const uv = um.get(`${sub}:${key}`);
  if (uv !== undefined) return uv;              // override user (bật/tắt) thắng
  if (role) {
    const rm = await roleRestrictionMap();
    if (rm.get(`${role}:${key}`)) return true;  // mặc định role
  }
  return false;
}
