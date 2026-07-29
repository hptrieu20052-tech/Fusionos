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

// Tải 1 ảnh về server (thử nhiều size Etsy nếu bản fullxfull không tồn tại) → trả Blob để upload thẳng.
// Lý do tồn tại: gửi album bằng URL hay dính "WEBPAGE_MEDIA_EMPTY" — Telegram không tự tải được ảnh
// (CDN chặn bot, hoặc link ipf_fullxfull do mình tự đổi ra KHÔNG tồn tại với một số file khách upload).
async function fetchImageBytes(u: string): Promise<Blob | null> {
  const cands = [u];
  if (/ipf_fullxfull/i.test(u)) {
    // Ảnh khách upload trên Etsy không phải file nào cũng có bản fullxfull → lùi dần size vẫn đủ nét để design
    cands.push(u.replace(/ipf_fullxfull/i, "ipf_1588xN"), u.replace(/ipf_fullxfull/i, "ipf_680x540"), u.replace(/ipf_fullxfull/i, "ipf_300x300"));
  }
  for (const c of cands) {
    try {
      const r = await fetch(c, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) continue;
      const ct = (r.headers.get("content-type") ?? "").toLowerCase();
      const buf = await r.arrayBuffer();
      // Telegram nhận photo ≤ ~10MB; loại luôn response rỗng/trang HTML lỗi
      if (buf.byteLength < 200 || buf.byteLength > 9_800_000) continue;
      if (!ct.startsWith("image/") && !/\.(jpe?g|png|webp)(\?|$)/i.test(c)) continue;
      return new Blob([buf], { type: ct.startsWith("image/") ? ct : "image/jpeg" });
    } catch { /* thử ứng viên kế tiếp */ }
  }
  return null;
}

// PHƯƠNG ÁN B: tự tải ảnh về rồi UPLOAD bytes cho Telegram (multipart attach://) — không bắt Telegram đi tải.
// Ảnh nào tải không nổi thì BỎ QUA ảnh đó thay vì chết cả album.
async function sendBatchByUpload(token: string, chatId: string, batch: string[], caption?: string): Promise<{ ok: boolean; error?: string; skipped: number }> {
  const fd = new FormData();
  const media: Record<string, unknown>[] = [];
  let idx = 0, skipped = 0;
  for (const u of batch) {
    const blob = await fetchImageBytes(u);
    if (!blob) { skipped++; continue; }
    const key = `f${idx++}`;
    fd.append(key, blob, `${key}.jpg`);
    media.push({ type: "photo", media: `attach://${key}` });
  }
  if (!media.length) return { ok: false, error: "no downloadable images in batch", skipped };
  if (caption) { media[0].caption = caption; media[0].parse_mode = "HTML"; }
  fd.append("chat_id", chatId.trim());
  fd.append("media", JSON.stringify(media));
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMediaGroup`, {
      method: "POST", body: fd, signal: AbortSignal.timeout(45000),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    return j.ok ? { ok: true, skipped } : { ok: false, error: String(j.description ?? res.status).slice(0, 200), skipped };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200), skipped };
  }
}

// Gửi ALBUM ảnh (sendMediaGroup) — tối đa 10 ảnh/nhóm, tự chia lô nếu nhiều hơn. caption đặt ở ảnh đầu nhóm đầu.
// Lô nào gửi bằng URL bị Telegram từ chối (WEBPAGE_MEDIA_EMPTY / WRONG_TYPE…) → tự chuyển sang tải về + upload bytes.
export async function sendTelegramMediaGroup(chatId: string, photoUrls: string[], caption?: string): Promise<{ ok: boolean; error?: string }> {
  const token = TOKEN();
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" };
  const urls = photoUrls.filter(Boolean);
  if (!urls.length) return { ok: true };
  let firstErr = "";
  for (let i = 0; i < urls.length; i += 10) {
    const batch = urls.slice(i, i + 10);
    const cap = i === 0 ? caption : undefined;
    const media = batch.map((u, j) => {
      const m: Record<string, unknown> = { type: "photo", media: u };
      if (j === 0 && cap) { m.caption = cap; m.parse_mode = "HTML"; }
      return m;
    });
    let batchErr = "";
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMediaGroup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId.trim(), media }),
        signal: AbortSignal.timeout(25000),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
      if (!j.ok) batchErr = String(j.description ?? res.status);
    } catch (e) { batchErr = String((e as Error)?.message ?? e); }
    // URL fail → phương án B: server tải ảnh về, upload thẳng cho Telegram
    if (batchErr) {
      const up = await sendBatchByUpload(token, chatId, batch, cap);
      if (!up.ok && !firstErr) firstErr = `${batchErr} (retry-upload: ${up.error})`;
    }
    await new Promise((r) => setTimeout(r, 400)); // giãn nhịp giữa các lô
  }
  return firstErr ? { ok: false, error: firstErr.slice(0, 200) } : { ok: true };
}

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
