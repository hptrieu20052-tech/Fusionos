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
export function invalidatePermissionCache() { cache = null; }

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

export async function hasRestriction(userId: string, key: string): Promise<boolean> {
  const [r] = await db
    .select()
    .from(schema.userRestrictions)
    .where(and(eq(schema.userRestrictions.userId, userId), eq(schema.userRestrictions.restrictionKey, key)))
    .limit(1);
  return !!r?.enabled;
}
