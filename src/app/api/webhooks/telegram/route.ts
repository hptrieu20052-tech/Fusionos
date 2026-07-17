import { NextRequest, NextResponse } from "next/server";
import { sendTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// POST /api/webhooks/telegram — nhận update từ Telegram bot.
// Ai nhắn cho bot (designer bấm Start) → bot TỰ TRẢ LỜI chat id của họ để gửi admin điền vào Staff.
// Bảo mật: header x-telegram-bot-api-secret-token phải khớp TELEGRAM_WEBHOOK_SECRET (nếu đã set).
export async function POST(req: NextRequest) {
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const u = await req.json().catch(() => null);
  const msg = u?.message || u?.edited_message || u?.channel_post;
  const chat = msg?.chat;
  if (chat?.id != null) {
    const who = chat.title || [msg?.from?.first_name, msg?.from?.last_name].filter(Boolean).join(" ") || "";
    const text =
      `✅ <b>Chat ID của bạn</b>${who ? ` (${String(who).replace(/[<>&]/g, "")})` : ""}:\n` +
      `<code>${chat.id}</code>\n\n` +
      `Gửi số này cho admin để điền vào FUSION → Admin → Staff (ô Telegram chat ID). Xong là bạn nhận được đơn seller gửi qua đây.`;
    try { await sendTelegram(String(chat.id), text); } catch { /* fire-and-forget */ }
  }
  return NextResponse.json({ ok: true }); // luôn 200 để Telegram không retry
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "telegram-webhook" });
}
