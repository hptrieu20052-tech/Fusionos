import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { orChatJSON } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * v207 · POST /api/videos/captions { id, tone? } → AI viết caption + hashtag CHO TỪNG KÊNH.
 *
 * Đây là phần "dọn sẵn" của giai đoạn 1: người vẫn là người bấm đăng, nhưng không phải ngồi
 * nghĩ caption 5 lần cho 5 kênh. Caption viết từ ĐÚNG dữ liệu listing đang có — không bịa.
 *
 * LUẬT CỨNG (đã cháy một lần vì cái này ở chatbot Chatty, không lặp lại):
 *   · KHÔNG bịa giảm giá / mã coupon / "sale sắp hết hạn" — Talewix không chạy discount tự động.
 *   · KHÔNG hứa ngày giao cụ thể, chỉ dùng khoảng ngày làm việc có thật.
 *   · KHÔNG nhắc tên thương hiệu / nhân vật có bản quyền (PAW Patrol, Disney…) — rủi ro IP.
 *   · KHÔNG bịa review, số sao, "best seller", "hàng nghìn khách".
 */
type Caption = { text: string; hashtags: string[] };
type Out = { tiktok: Caption; reels: Caption; shorts: Caption; facebook: Caption; pinterest: Caption };

const CHANNELS = ["tiktok", "reels", "shorts", "facebook", "pinterest"] as const;

const SYSTEM = `You write short-form social captions for Talewix, a store selling personalized children's books and personalized wooden name puzzles, each made to order.

Write ONE caption per channel, tuned to how that channel actually reads:
- tiktok: 100-150 chars, hook in the first line, casual and spoken, 3-5 hashtags.
- reels: 100-150 chars, warm and gift-focused, 3-5 hashtags.
- shorts: under 100 chars, punchy, searchable phrasing, 3-5 hashtags.
- facebook: 200-320 chars, full sentences, aimed at parents and grandparents, 0-2 hashtags.
- pinterest: 100-200 chars, descriptive and keyword-rich (people search Pinterest like a search engine), 3-5 hashtags.

ABSOLUTE RULES — breaking any of these makes the output unusable:
1. NEVER invent a discount, coupon code, sale, percentage off, or any "limited time" or "expires soon" urgency. The store runs no automatic discounts.
2. NEVER promise a specific delivery date. Only use the business-day ranges given in the product facts, and only if they are provided.
3. NEVER mention any copyrighted or trademarked brand or character (Disney, PAW Patrol, Bluey, Marvel, Pokemon, etc.), even if the product data hints at one.
4. NEVER invent reviews, ratings, star counts, customer numbers, or "best seller" / "#1" claims.
5. NEVER state a price unless the price is given in the product facts.
6. Write in natural US English. No emoji spam — at most 2 emoji per caption, and none is fine.

Return STRICT JSON only, no markdown fence:
{"tiktok":{"text":"...","hashtags":["#a","#b"]},"reels":{...},"shorts":{...},"facebook":{...},"pinterest":{...}}
Every hashtag must start with "#", be lowercase, contain no spaces, and be relevant to personalized gifts for kids.`;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const [row] = await db.select({
    v: schema.productVideos,
    pTitle: schema.shopifyProducts.title,
    pType: schema.shopifyProducts.productType,
    pTags: schema.shopifyProducts.tags,
    pSeo: schema.shopifyProducts.seoDescription,
    pFeed: schema.shopifyProducts.feedDescription,
    pUrl: schema.shopifyProducts.onlineStoreUrl,
    pVariants: schema.shopifyProducts.variants,
  }).from(schema.productVideos)
    .leftJoin(schema.shopifyProducts, eq(schema.shopifyProducts.id, schema.productVideos.productId))
    .where(eq(schema.productVideos.id, id)).limit(1);

  if (!row) return NextResponse.json({ ok: false, error: "video not found" }, { status: 404 });
  if (!row.v.productId || !row.pTitle) {
    return NextResponse.json({ ok: false, error: "link this video to a Shopify listing first — captions are written from the listing data" }, { status: 400 });
  }

  // Giá lấy từ variant rẻ nhất, chỉ để AI có số THẬT mà dùng; không có thì AI không được nhắc giá.
  const prices = (Array.isArray(row.pVariants) ? row.pVariants as { price?: string }[] : [])
    .map((v) => Number(v?.price)).filter((n) => isFinite(n) && n > 0);
  const minPrice = prices.length ? Math.min(...prices) : null;

  const type = String(row.pType ?? "").toLowerCase();
  // Số ngày giao CHÍNH THỨC — khớp Shipping Policy trên site. Puzzle chậm hơn sách và KHÔNG có express.
  const delivery = /puzzle/.test(type)
    ? "Production 2-4 business days, then US shipping 8-12 business days (about 10-16 business days total in the US). No express option for puzzles."
    : /book/.test(type)
      ? "Production 2-4 business days, then US shipping 5-8 business days (about 7-12 business days total in the US)."
      : "";

  const plain = (s: unknown) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const facts = [
    `Product title: ${row.pTitle}`,
    row.pType ? `Product type: ${row.pType}` : "",
    row.pTags ? `Tags: ${String(row.pTags).slice(0, 300)}` : "",
    plain(row.pFeed) || plain(row.pSeo) ? `Description: ${(plain(row.pFeed) || plain(row.pSeo)).slice(0, 700)}` : "",
    minPrice != null ? `Price: $${minPrice.toFixed(2)} (you may mention this exact price, or omit it)` : "Price: NOT PROVIDED — do not mention any price.",
    delivery ? `Delivery (only timing you may cite): ${delivery}` : "Delivery: NOT PROVIDED — do not mention delivery times.",
    `Free US shipping on every order, no minimum. This is true and may be mentioned.`,
    row.v.title ? `What the video shows: ${row.v.title}` : "",
    row.v.note ? `Extra note about the video: ${String(row.v.note).slice(0, 300)}` : "",
    row.pUrl ? `Product URL: ${row.pUrl}` : "",
    row.v.aspect ? `Video aspect ratio: ${row.v.aspect}` : "",
  ].filter(Boolean).join("\n");

  let out: Out;
  try {
    out = await orChatJSON<Out>(SYSTEM, facts, { maxTokens: 1600, temperature: 0.8, timeoutMs: 90_000 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "AI error: " + String((e as Error)?.message ?? e).slice(0, 200) }, { status: 502 });
  }

  // Dọn output: cắt độ dài, chuẩn hoá hashtag, bỏ kênh nào AI trả thiếu.
  const clean = (c: unknown): Caption | null => {
    const o = (c ?? {}) as { text?: unknown; hashtags?: unknown };
    const text = String(o.text ?? "").replace(/\s+/g, " ").trim().slice(0, 900);
    if (!text) return null;
    const tags = (Array.isArray(o.hashtags) ? o.hashtags : [])
      .map((t) => String(t).trim().replace(/^#*/, "#").replace(/\s+/g, "").toLowerCase())
      .filter((t) => t.length > 1 && t.length <= 40)
      .slice(0, 8);
    return { text, hashtags: Array.from(new Set(tags)) };
  };
  const captions: Record<string, Caption> = {};
  for (const ch of CHANNELS) {
    const c = clean((out as unknown as Record<string, unknown>)[ch]);
    if (c) captions[ch] = c;
  }
  if (!Object.keys(captions).length) {
    return NextResponse.json({ ok: false, error: "AI returned nothing usable — try again" }, { status: 502 });
  }

  await db.update(schema.productVideos)
    .set({ captions, captionsAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.productVideos.id, id));

  return NextResponse.json({ ok: true, captions });
}
