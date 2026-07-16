// Helper cho Support inbox (TikTok Customer Service). Resolve store→cfg (scope seller) + rút gọn conversation/message.
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import type { Session } from "@/lib/auth";
import { storeOwnerScopeIds } from "@/lib/scope";
import { ttGetValidCfg, type TtCfg } from "@/lib/tiktok-shop";

type StoreRow = typeof schema.stores.$inferSelect;
export type ResolvedStore =
  | { ok: false; error: string; status: number }
  | { ok: true; store: StoreRow; cfg: TtCfg };

// Store TikTok theo id + chặn scope (seller chỉ store mình).
export async function resolveStore(session: Session, storeId: string): Promise<ResolvedStore> {
  const [store] = await db.select().from(schema.stores)
    .where(and(eq(schema.stores.id, storeId), eq(schema.stores.marketplace, "tiktok"))).limit(1);
  if (!store) return { ok: false, error: "store not found", status: 404 };
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && !(store.sellerId && scopeIds.includes(store.sellerId))) return { ok: false, error: "forbidden", status: 403 };
  try {
    const cfg = await ttGetValidCfg(store.id, (store.apiCredentials ?? null) as Record<string, string> | null);
    return { ok: true, store, cfg };
  } catch (e) {
    return { ok: false, error: "Store not connected to TikTok: " + String((e as Error)?.message ?? e).slice(0, 120), status: 400 };
  }
}

// content của message là JSON string → text/imageUrl để hiển thị.
export function parseMsgContent(type: string, contentStr: unknown): { text: string; imageUrl: string | null } {
  let c: Record<string, unknown> = {};
  try { c = JSON.parse(typeof contentStr === "string" ? contentStr : "{}"); } catch { /* ignore */ }
  const s = (k: string) => (c[k] != null ? String(c[k]) : "");
  switch (type) {
    case "TEXT": case "NOTIFICATION": case "ALLOCATED_SERVICE": case "BUYER_ENTER_FROM_TRANSFER": case "OTHER": case "EMOTICONS":
      return { text: s("content"), imageUrl: null };
    case "IMAGE": return { text: "", imageUrl: s("url") || null };
    case "VIDEO": return { text: "[Video]", imageUrl: s("cover") || null };
    case "PRODUCT_CARD": case "BUYER_ENTER_FROM_PRODUCT": return { text: `[Product ${s("product_id")}]`, imageUrl: null };
    case "ORDER_CARD": case "BUYER_ENTER_FROM_ORDER": return { text: `[Order ${s("order_id")}]`, imageUrl: null };
    case "RETURN_REFUND_CARD": return { text: `[Return/Refund ${s("order_id")}]`, imageUrl: null };
    case "COUPON_CARD": return { text: "[Coupon]", imageUrl: null };
    default: return { text: `[${type}]`, imageUrl: null };
  }
}

type Participant = { role?: string; nickname?: string; avatar?: string };
type LatestMsg = { type?: string; content?: unknown; create_time?: number; sender?: { role?: string; nickname?: string } };

// 1 conversation (từ Get Conversations) → shape gọn cho inbox.
export function simplifyConversation(cv: Record<string, unknown>, storeId: string, storeName: string) {
  const parts = (cv.participants as Participant[] | undefined) ?? [];
  const buyer = parts.find((p) => p.role === "BUYER");
  const lm = cv.latest_message as LatestMsg | undefined;
  const parsed = lm ? parseMsgContent(String(lm.type ?? "TEXT"), lm.content) : { text: "", imageUrl: null };
  return {
    id: String(cv.id ?? ""),
    storeId, storeName,
    buyerName: buyer?.nickname ?? "Buyer",
    buyerAvatar: buyer?.avatar ?? null,
    unread: Number(cv.unread_count ?? 0),
    canSend: !!cv.can_send_message,
    lastText: parsed.text || (parsed.imageUrl ? "[Image]" : ""),
    lastFromBuyer: lm?.sender?.role === "BUYER",
    lastTime: Number(lm?.create_time ?? cv.create_time ?? 0),
  };
}

// 1 message (từ Get Conversation Messages) → shape gọn cho khung chat.
export function simplifyMessage(m: Record<string, unknown>) {
  const sender = (m.sender as { role?: string; nickname?: string; avatar?: string } | undefined) ?? {};
  const type = String(m.type ?? "TEXT");
  const parsed = parseMsgContent(type, m.content);
  return {
    id: String(m.id ?? ""),
    type,
    role: sender.role ?? "BUYER",
    name: sender.nickname ?? "",
    avatar: sender.avatar ?? null,
    text: parsed.text,
    imageUrl: parsed.imageUrl,
    time: Number(m.create_time ?? 0),
    index: String(m.index ?? ""),
    isVisible: m.is_visible !== false,
  };
}
