// Tầng "prompt có thể ghi đè": route/lib gọi getPrompt(id) thay vì nhúng prompt cứng.
//   - Có bản admin ghi đè trong bảng ai_prompts → dùng bản đó.
//   - Không có → rơi về default trong prompt-defs.ts (nguồn gốc, sinh từ scripts/gen-prompts.cjs).
// Bảng chưa migrate (chưa chạy db:push) → tự bắt lỗi, trả default → tính năng AI KHÔNG bao giờ chết vì thiếu bảng.
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { PROMPT_DEFAULTS, PROMPT_META, type PromptMeta } from "@/lib/ai/prompt-defs";

// Cache toàn bộ override 15s (1 query nhẹ, tránh gọi DB mỗi lần gen). Save/reset gọi invalidate.
let cache: { at: number; map: Map<string, string> } | null = null;

async function overrideMap(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < 15_000) return cache.map;
  let rows: { id: string; value: string }[] = [];
  try {
    rows = await db.select({ id: schema.aiPrompts.id, value: schema.aiPrompts.value }).from(schema.aiPrompts);
  } catch {
    // bảng chưa tồn tại / lỗi DB → coi như không có override, vẫn chạy bằng default
    rows = [];
  }
  const map = new Map(rows.map((r) => [r.id, r.value]));
  cache = { at: Date.now(), map };
  return map;
}

export function invalidatePromptCache() { cache = null; }

/** Prompt hiệu lực cho id: admin ghi đè (nếu có) → default. id lạ → chuỗi rỗng (an toàn). */
export async function getPrompt(id: string): Promise<string> {
  const ov = (await overrideMap()).get(id);
  if (typeof ov === "string" && ov.trim()) return ov;
  return PROMPT_DEFAULTS[id] ?? "";
}

export type PromptRow = PromptMeta & { def: string; override: string | null; effective: string; overridden: boolean };

/** Danh sách đầy đủ cho trang admin: meta + default + override + bản hiệu lực. */
export async function listPromptsForAdmin(): Promise<PromptRow[]> {
  const ov = await overrideMap();
  return PROMPT_META.map((m): PromptRow => {
    const def = PROMPT_DEFAULTS[m.id] ?? "";
    const override = ov.has(m.id) ? String(ov.get(m.id)) : null;
    const overridden = typeof override === "string" && override.trim().length > 0;
    return { ...m, def, override, overridden, effective: overridden ? (override as string) : def };
  });
}

const KNOWN = new Set(PROMPT_META.map((m) => m.id));

/** Ghi đè 1 prompt (chỉ id hợp lệ). value trùng default → coi như reset (xoá dòng) để không lưu rác. */
export async function savePrompt(id: string, value: string, userId?: string): Promise<void> {
  if (!KNOWN.has(id)) throw new Error("unknown prompt id");
  const v = String(value ?? "");
  const def = PROMPT_DEFAULTS[id] ?? "";
  if (!v.trim() || v === def) { await resetPrompt(id); return; }
  await db.insert(schema.aiPrompts)
    .values({ id, value: v, updatedBy: userId ?? null })
    .onConflictDoUpdate({ target: schema.aiPrompts.id, set: { value: v, updatedBy: userId ?? null, updatedAt: new Date() } });
  invalidatePromptCache();
}

/** Xoá override → về default. */
export async function resetPrompt(id: string): Promise<void> {
  if (!KNOWN.has(id)) throw new Error("unknown prompt id");
  await db.delete(schema.aiPrompts).where(eq(schema.aiPrompts.id, id));
  invalidatePromptCache();
}
