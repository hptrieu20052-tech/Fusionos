import { db, schema } from "@/lib/db";
import type { Session } from "@/lib/auth";

// Cache quyền hành động theo role (denials) + theo user (override enabled/false).
let acache: { at: number; denied: Set<string> } | null = null;
let uacache: { at: number; map: Map<string, boolean> } | null = null;
async function deniedSet(): Promise<Set<string>> {
  if (acache && Date.now() - acache.at < 30_000) return acache.denied;
  const rows = await db.select().from(schema.roleActions).catch(() => [] as { role: string; actionKey: string; enabled: boolean }[]);
  const denied = new Set(rows.filter((r) => !r.enabled).map((r) => `${r.role}:${r.actionKey}`));
  acache = { at: Date.now(), denied };
  return denied;
}
async function userActionMap(): Promise<Map<string, boolean>> {
  if (uacache && Date.now() - uacache.at < 30_000) return uacache.map;
  const rows = await db.select().from(schema.userActions).catch(() => [] as { userId: string; actionKey: string; enabled: boolean }[]);
  const map = new Map(rows.map((r) => [`${r.userId}:${r.actionKey}`, r.enabled]));
  uacache = { at: Date.now(), map };
  return map;
}
export function invalidateActionCache() { acache = null; uacache = null; }

/** Role/user có được phép hành động này không. Override user → role → mặc định cho phép. Admin luôn true. */
export async function hasAction(session: Session, actionKey: string): Promise<boolean> {
  if (session.role === "admin") return true;
  const uv = (await userActionMap()).get(`${session.sub}:${actionKey}`);
  if (uv !== undefined) return uv;
  const denied = await deniedSet();
  return !denied.has(`${session.role}:${actionKey}`);
}
