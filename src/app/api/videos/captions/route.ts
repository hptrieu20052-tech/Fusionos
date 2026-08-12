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
// title chỉ dùng cho YouTube Short (YT tách Title ngắn ≤100 ký tự khỏi Description).
type Caption = { text: string; hashtags: string[]; title?: string };
type Out = { facebook: Caption; instagram: Caption; shorts: Caption; meta_ads: Caption };

// Facebook & Instagram TÁCH RIÊNG (FB ít hashtag + có link; IG nhiều hashtag + link ở bio).
const CHANNELS = ["facebook", "instagram", "shorts", "meta_ads"] as const;

const SYSTEM = `You write short-form marketing copy for Talewix, a store selling personalized children's books and personalized wooden name puzzles, each made to order.

Write copy for FOUR destinations, each tuned to how it is used (Facebook and Instagram are SEPARATE because their hashtag and link behavior differ):
- facebook: a Facebook Reel caption. 120-180 chars, warm and gift-focused, hook in the first line, natural spoken tone. Only 2-3 hashtags (Facebook barely uses them). The user will paste a clickable product link after this text, so end the text cleanly.
- instagram: an Instagram Reel caption. 120-180 chars, same warm hook style. Then 10-14 hashtags (Instagram relies heavily on them for discovery). The link goes in the bio, not the caption, so do NOT put a URL here.
- shorts: for a YouTube Short, YouTube separates Title from Description, so give BOTH: a "title" = a punchy, keyword-rich YouTube title UNDER 90 characters (NO hashtags, NO url inside the title); and "text" = a 1-2 line description. Plus 3-5 hashtags (they go in the description).
- meta_ads: PAID ad primary text (Facebook/Instagram ads). 90-125 chars, benefit-led and clear, speaks to a parent or grandparent buying a gift, no clickbait, 0-2 hashtags.

HASHTAG STRATEGY (for the instagram hashtags): give a MIX so the post can rank in both big and niche feeds:
- 3-4 BROAD high-reach tags (e.g. #personalizedgifts, #kidsbooks, #giftsforkids, #customgifts).
- 4-5 NICHE/specific tags tied to THIS product and who it suits (e.g. #personalizedmermaidbook, #mermaidgift, #customstorybook, #keepsakebook).
- 2-3 OCCASION/buyer tags (e.g. #birthdaygiftforgirls, #granddaughtergift, #giftforher).
Order them broad → niche. Keep every tag genuinely relevant (no filler, no unrelated trending tags). You cannot know live hashtag volume, so favor clearly on-topic tags over guessing what's "trending".

ABSOLUTE RULES — breaking any of these makes the output unusable:
1. NEVER invent a discount, coupon code, sale, percentage off, or any "limited time" or "expires soon" urgency. The store runs no automatic discounts.
2. NEVER promise a specific delivery date. Only use the business-day ranges given in the product facts, and only if they are provided.
3. NEVER mention any copyrighted or trademarked brand or character (Disney, PAW Patrol, Bluey, Marvel, Pokemon, etc.), even if the product data hints at one.
4. NEVER invent reviews, ratings, star counts, customer numbers, or "best seller" / "#1" claims.
5. NEVER state a price unless the price is given in the product facts.
6. Write in natural US English. No emoji spam — at most 2 emoji per caption, and none is fine.
7. If a product image and/or a still frame from the video are provided, use them to keep the description concrete and accurate (what the product actually is, its style, who it suits). But NEVER name or imply any real brand or copyrighted character even if you think you recognize one in the image (see rule 3).

Return STRICT JSON only, no markdown fence:
{"facebook":{"text":"...","hashtags":["#a","#b"]},"instagram":{...},"shorts":{"title":"...","text":"...","hashtags":["#a"]},"meta_ads":{...}}
Every hashtag must start with "#", be lowercase, contain no spaces, and be relevant to personalized gifts for kids.`;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "videos")) < 2) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  // Model AI người dùng chọn ngay trước khi Generate — trống thì để orChatJSON dùng model mặc định (env).
  const model = typeof b?.model === "string" && b.model.trim() ? String(b.model).trim().slice(0, 120) : undefined;
  // Client báo model đang chọn có ĐỌC ĐƯỢC ẢNH không (fetch danh sách vision phía client, khỏi gọi lại ở đây).
  // Chỉ nhét ảnh khi model đọc được ảnh — model text thuần mà kèm ảnh sẽ lỗi.
  const withImages = b?.withImages !== false;

  const [row] = await db.select({
    v: schema.productVideos,
    pTitle: schema.shopifyProducts.title,
    pType: schema.shopifyProducts.productType,
    pTags: schema.shopifyProducts.tags,
    pSeo: schema.shopifyProducts.seoDescription,
    pFeed: schema.shopifyProducts.feedDescription,
    pUrl: schema.shopifyProducts.onlineStoreUrl,
    pVariants: schema.shopifyProducts.variants,
    pImages: schema.shopifyProducts.images,
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

  // Ảnh giúp AI tả đúng cái đang thấy: (1) ảnh listing (sản phẩm sạch, đáng tin), (2) frame video (đúng cảnh clip).
  // Chỉ gửi khi model đọc được ảnh. Tối đa 2 ảnh cho gọn token.
  const images: string[] = [];
  if (withImages) {
    const arr = Array.isArray(row.pImages) ? row.pImages as { src?: unknown; position?: unknown }[] : [];
    const firstSrc = arr.slice().sort((a, b) => (Number(a?.position) || 0) - (Number(b?.position) || 0))[0]?.src;
    if (firstSrc && /^https?:\/\//i.test(String(firstSrc))) images.push(String(firstSrc));
    if (row.v.thumbUrl && /^https?:\/\//i.test(String(row.v.thumbUrl))) images.push(String(row.v.thumbUrl));
  }

  let out: Out;
  try {
    out = await orChatJSON<Out>(SYSTEM, facts, { model, images: images.length ? images.slice(0, 2) : undefined, maxTokens: 1600, temperature: 0.8, timeoutMs: 90_000 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "AI error: " + String((e as Error)?.message ?? e).slice(0, 200) }, { status: 502 });
  }

  // Dọn output: cắt độ dài, chuẩn hoá hashtag, bỏ kênh nào AI trả thiếu.
  const clean = (c: unknown): Caption | null => {
    const o = (c ?? {}) as { text?: unknown; hashtags?: unknown; title?: unknown };
    const text = String(o.text ?? "").replace(/\s+/g, " ").trim().slice(0, 900);
    if (!text) return null;
    const tags = (Array.isArray(o.hashtags) ? o.hashtags : [])
      .map((t) => String(t).trim().replace(/^#*/, "#").replace(/\s+/g, "").toLowerCase())
      .filter((t) => t.length > 1 && t.length <= 40)
      .slice(0, 15);
    const out: Caption = { text, hashtags: Array.from(new Set(tags)) };
    // Title riêng cho YouTube Short (nếu model trả về) — cắt ≤100 để đúng giới hạn YouTube.
    const title = String(o.title ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (title) out.title = title;
    return out;
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
