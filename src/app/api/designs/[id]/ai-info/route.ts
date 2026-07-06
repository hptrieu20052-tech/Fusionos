import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// POST /api/designs/[id]/ai-info — sinh Title/Description/Tags chuẩn listing.
// Có ANTHROPIC_API_KEY trong .env → gọi Claude; không có → sinh theo mẫu.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const [d] = await db.select().from(schema.designs).where(eq(schema.designs.id, params.id)).limit(1);
  if (!d) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 700,
          messages: [{
            role: "user",
            content: `Bạn là chuyên gia viết listing POD (print-on-demand) cho Etsy/Amazon/TikTok Shop.
Design hiện tại: title="${d.title}", tags=${JSON.stringify(d.tags)}, personalize=${d.personalize}.
Viết lại giúp tôi và trả về CHỈ JSON (không markdown): {"title": "...tối đa 130 ký tự, chuẩn SEO...", "description": "...3-5 câu bán hàng, nêu chất liệu/dịp tặng...", "tags": ["...13 tag, mỗi tag <20 ký tự..."]}`,
          }],
        }),
      });
      const j = await r.json();
      const text = (j.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      return NextResponse.json({ ok: true, source: "ai", ...parsed });
    } catch {
      // rơi xuống template nếu AI lỗi
    }
  }

  // Fallback theo mẫu khi chưa cấu hình AI
  const base = d.title.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const cap = base.replace(/\b\w/g, (c) => c.toUpperCase());
  const tags = Array.from(new Set([
    ...d.tags,
    ...base.toLowerCase().split(" ").filter((w) => w.length >= 4),
    d.personalize ? "personalized gift" : "custom design",
  ])).slice(0, 13);
  return NextResponse.json({
    ok: true, source: "template",
    title: cap,
    description: `${cap} — thiết kế độc quyền từ FUSION. ${d.personalize ? "Có thể cá nhân hoá theo tên/yêu cầu của khách. " : ""}Phù hợp làm quà tặng và sản phẩm chủ lực trên Etsy, Amazon, TikTok Shop.`,
    tags,
    hint: "Thêm ANTHROPIC_API_KEY vào .env để dùng AI thật.",
  });
}
