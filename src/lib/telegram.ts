import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";

/**
 * THÔNG BÁO SALE VỀ TELEGRAM theo từng team.
 * Setup:
 *  1. Tạo bot qua @BotFather → lấy token → env TELEGRAM_BOT_TOKEN trên Vercel.
 *  2. Thêm bot vào group của từng team → lấy chat id (group id âm, vd -1001234567890):
 *     nhắn 1 tin trong group rồi mở https://api.telegram.org/bot<TOKEN>/getUpdates để xem "chat":{"id":...}
 *     (hoặc dùng @RawDataBot). Dán chat id vào Admin → Teams → ô Telegram chat ID.
 *  3. (Tuỳ chọn) env TELEGRAM_DEFAULT_CHAT_ID — nhận đơn KHÔNG xác định được team (group chung/admin).
 * Nguyên tắc: fire-and-forget — lỗi Telegram không bao giờ làm hỏng luồng kéo đơn.
 */

const TOKEN = () => (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sendTelegram(chatId: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const token = TOKEN();
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId.trim(), text: html, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000), // tạo TRONG request — không đặt module level
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    return j.ok ? { ok: true } : { ok: false, error: String(j.description ?? res.status).slice(0, 200) };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

const money = (v: unknown) => "$" + Number(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Bắn thông báo SALE cho danh sách đơn VỪA TẠO (gọi sau ingest/import).
 * Gom theo chat: seller.team → teams.telegram_chat_id; không có team/chat → TELEGRAM_DEFAULT_CHAT_ID.
 * 1 đơn → tin chi tiết; nhiều đơn cùng team → digest (tối đa 10 dòng) chống spam group.
 */
export async function notifyNewSales(orderIds: string[]): Promise<void> {
  try {
    if (!orderIds.length || !TOKEN()) return;
    const orders = await db.select({
      id: schema.orders.id, externalId: schema.orders.externalId, orderLabel: schema.orders.orderLabel,
      total: schema.orders.total, platform: schema.orders.platform,
      sellerId: schema.orders.sellerId, storeId: schema.orders.storeId,
    }).from(schema.orders).where(inArray(schema.orders.id, orderIds.slice(0, 200)));
    if (!orders.length) return;

    const sellerIds = Array.from(new Set(orders.map((o) => o.sellerId).filter(Boolean))) as string[];
    const storeIds = Array.from(new Set(orders.map((o) => o.storeId).filter(Boolean))) as string[];
    const [sellers, stores, teams] = await Promise.all([
      sellerIds.length ? db.select({ id: schema.users.id, name: schema.users.fullName, team: schema.users.team }).from(schema.users).where(inArray(schema.users.id, sellerIds)) : Promise.resolve([]),
      storeIds.length ? db.select({ id: schema.stores.id, name: schema.stores.name }).from(schema.stores).where(inArray(schema.stores.id, storeIds)) : Promise.resolve([]),
      db.select().from(schema.teams),
    ]);
    const sellerOf = new Map(sellers.map((s) => [s.id, s]));
    const storeOf = new Map(stores.map((s) => [s.id, s.name]));
    const chatOfTeam = new Map(teams.filter((t) => t.telegramChatId?.trim()).map((t) => [t.name, t.telegramChatId!.trim()]));
    const defaultChat = (process.env.TELEGRAM_DEFAULT_CHAT_ID ?? "").trim();
    // Kênh TOÀN CÔNG TY (admin/quản lý không thuộc team): env TELEGRAM_ALL_CHAT_ID —
    // nhận MỌI đơn, song song với group team. Có thể là group riêng hoặc chat cá nhân với bot.
    const allChat = (process.env.TELEGRAM_ALL_CHAT_ID ?? "").trim();

    // Gom đơn theo chat id đích (1 đơn có thể tới 2 nơi: group team + kênh toàn công ty)
    const byChat = new Map<string, typeof orders>();
    const push = (chat: string, o: (typeof orders)[number]) => {
      if (!chat) return;
      if (!byChat.has(chat)) byChat.set(chat, []);
      const list = byChat.get(chat)!;
      if (!list.some((x) => x.id === o.id)) list.push(o);
    };
    for (const o of orders) {
      const seller = o.sellerId ? sellerOf.get(o.sellerId) : undefined;
      push((seller?.team && chatOfTeam.get(seller.team)) || defaultChat, o);
      push(allChat, o);
    }

    const line = (o: (typeof orders)[number]) => {
      const seller = o.sellerId ? sellerOf.get(o.sellerId) : undefined;
      const store = o.storeId ? storeOf.get(o.storeId) : undefined;
      // Bố cục: 🛒 NEW SALE! SÀN · seller · store #label · $total
      return `🛒 <b>NEW SALE!</b> ${esc(String(o.platform).toUpperCase())}${seller ? ` · ${esc(seller.name)}` : ""}${store ? ` · ${esc(store)}` : ""} <b>#${esc(o.orderLabel || o.externalId)}</b> · <b>${money(o.total)}</b>`;
    };

    // MỖI ĐƠN 1 THÔNG BÁO riêng (kể cả 12 đơn = 12 tin) — gửi tuần tự + giãn 300ms
    // để không chạm rate limit Telegram (~20 tin/phút/group).
    for (const [chat, list] of Array.from(byChat.entries())) {
      for (const o of list) {
        await sendTelegram(chat, line(o));
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  } catch {
    // fire-and-forget: không bao giờ ném lỗi ra luồng ingest
  }
}
