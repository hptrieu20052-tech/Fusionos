import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { inScope } from "@/lib/scope";
import { splitVariant } from "@/lib/variant-display";
import { sendTelegram, sendTelegramMediaGroup } from "@/lib/telegram";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toFull = (u: string) => u.replace(/ipf_\d+x\d+/i, "ipf_fullxfull");

// POST /api/orders/[id]/send-designer { designerId } — gửi chi tiết đơn + ảnh khách cho designer qua Telegram.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const designerId = String(b?.designerId ?? "");
  if (!designerId) return NextResponse.json({ ok: false, error: "designerId required" }, { status: 400 });

  try {
  // Đơn + seller (tên + team)
  const order = (await db.execute(sql`
    SELECT o.id, o.external_id, o.order_label, o.buyer_note, o.seller_id,
           u.full_name AS seller_name, u.team AS seller_team
    FROM orders o LEFT JOIN users u ON u.id = o.seller_id
    WHERE o.id = ${params.id}::uuid
  `)).rows[0] as { id: string; external_id: string; order_label: string | null; buyer_note: string | null; seller_id: string | null; seller_name: string | null; seller_team: string | null } | undefined;
  if (!order) return NextResponse.json({ ok: false, error: "order not found" }, { status: 404 });
  if (!(await inScope(session, "orders", order.seller_id))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // Designer: phải cùng team seller + có chat id
  const [designer] = await db.select({ id: schema.users.id, name: schema.users.fullName, team: schema.users.team, chat: schema.users.telegramChatId, role: schema.users.role })
    .from(schema.users).where(eq(schema.users.id, designerId)).limit(1);
  if (!designer) return NextResponse.json({ ok: false, error: "designer not found" }, { status: 404 });
  if (!designer.chat) return NextResponse.json({ ok: false, error: `${designer.name} chưa có Telegram chat ID (Admin điền vào bảng Staff)` }, { status: 400 });
  if (order.seller_team && designer.team && order.seller_team !== designer.team) {
    return NextResponse.json({ ok: false, error: "Designer không cùng team với seller của đơn" }, { status: 400 });
  }

  const items = (await db.execute(sql`
    SELECT product_title, variant, personalization, qty, buyer_files, mockup_key, image_url
    FROM order_items WHERE order_id = ${params.id}::uuid ORDER BY created_at
  `)).rows as { product_title: string | null; variant: string | null; personalization: string | null; qty: number; buyer_files: unknown; mockup_key: string | null; image_url: string | null }[];

  // ===== Text: Seller · Order ID · từng item (title + personalization label:value + qty) · note khách =====
  const label = order.order_label || order.external_id;
  const lines: string[] = [
    "🎨 <b>ĐƠN CHO DESIGNER</b>",
    `Seller: <b>${esc(order.seller_name || "—")}</b>`,
    `Order: <b>#${esc(label)}</b>`,
    "",
  ];
  const mockups: string[] = [];   // ảnh mẫu sản phẩm (mockup) — gửi trước
  const photos: string[] = [];    // ảnh khách upload — gửi sau
  for (const it of items) {
    lines.push(`<b>${esc(it.product_title || "(no title)")}</b> · SL ${it.qty}`);
    const parts = splitVariant(it.variant);
    for (const p of parts) lines.push(p.label ? `• ${esc(p.label)}: <b>${esc(p.value)}</b>` : `• <b>${esc(p.value)}</b>`);
    const pz = (it.personalization ?? "").trim();
    if (pz && !parts.some((p) => (p.value || "").includes(pz.slice(0, 20)))) lines.push(`• Personalization: <b>${esc(pz)}</b>`);
    lines.push("");
    // Mockup (ảnh mẫu SP)
    const mk = (it.mockup_key ? fileUrl(it.mockup_key) : null) || it.image_url;
    if (mk && /^https?:\/\//i.test(mk)) mockups.push(mk);
    // Ảnh khách
    const files = Array.isArray(it.buyer_files) ? (it.buyer_files as { url?: string }[]) : [];
    for (const f of files) if (f?.url) photos.push(toFull(f.url));
  }
  if (order.buyer_note && order.buyer_note.trim()) lines.push(`📝 <b>Note khách:</b> ${esc(order.buyer_note.trim())}`);
  if (mockups.length) lines.push(`🖼 Kèm mockup + ${photos.length} ảnh khách`);

  const text = lines.join("\n").slice(0, 4000);
  const album = [...mockups, ...photos]; // mockup trước → ảnh khách sau

  try {
    const t1 = await sendTelegram(designer.chat, text);
    if (!t1.ok) return NextResponse.json({ ok: false, error: "Telegram: " + (t1.error ?? "failed") }, { status: 502 });
    let photoErr = "";
    if (album.length) {
      const t2 = await sendTelegramMediaGroup(designer.chat, album.slice(0, 50), `Mockup + ảnh khách · order #${label}`);
      if (!t2.ok) photoErr = t2.error ?? "photo failed";
    }
    await db.update(schema.orders).set({ designerSentTo: designer.name, designerSentAt: new Date() }).where(eq(schema.orders.id, order.id));
    return NextResponse.json({ ok: true, designer: designer.name, photos: photos.length, mockups: mockups.length, photoWarn: photoErr || undefined });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "telegram: " + String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
  } catch (e) {
    // Lỗi DB (thiếu cột migration, kết nối…) → luôn trả JSON để client hiện đúng lý do, không phải "network".
    return NextResponse.json({ ok: false, error: "server: " + String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
