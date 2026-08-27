import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { orChatJSON } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
// Vercel PRO: maxDuration tối đa 300s. Hạ về Hobby thì đưa về 60 / 52_000.
export const maxDuration = 300;
const BUDGET_MS = 270_000;

/**
 * POST /api/amazon-products/ai { ids, model? }   (ids = amazon_products.id)
 *
 * AI viết bộ copy AMAZON cho từng bản stage (KHÔNG đụng gì Shopify):
 *   - title       : 150-200 ký tự chuẩn SEO Amazon
 *   - bullets     : 5 bullet "About this item"
 *   - description : plain text 900-1500 ký tự
 * Nguồn facts + ảnh đọc JOIN từ shopify_products (listing gốc).
 *
 * Cùng cơ chế ai-optimize: ≤6 ids/request, song song lệch pha, retry 429/5xx, client chia lô.
 */
const MAX_PER_CALL = 6;

type Out = { amazonTitle?: string; bullets?: string[]; description?: string };

const SYSTEM = `You are an Amazon SEO copywriter for personalized children's books sold on Amazon.com (brand: Talewix, category: Baby Memory Books / keepsake gifts — NOT the Amazon Books category).

THE PRODUCT PHOTOS ARE ATTACHED — look at them first, then read the SOURCE LISTING block. Identify exactly what is personalized (child's name on cover, dedication messages, uploaded photo, character hair/skin option) and write only about what you can actually see or read. Address the shopper as "you".

Return STRICT JSON. Keys:
- "amazonTitle": Amazon product title, 150-200 characters, spaces included — NEVER under 140 or over 200. Structure: "Personalized <what it is>, Custom Name <product type>, <2-3 strong keyword phrases: occasion/recipient>, <Keepsake or occasion/recipient phrase>". Title Case. Front-load the strongest search terms.
  TITLE COMPLIANCE (Amazon suppresses/blocks titles that break these — code 100473). FORBIDDEN in the title:
  • Formatting: emojis, decorative symbols (★, ♥), ALL-CAPS words, the pipe "|", quotes, repeated punctuation (!!!, $$$), seller/brand-competitor names, and size (sizes are variations, never in the title).
  • The word "Gift" — do NOT use it in the title at all. Use "Keepsake" or name the occasion/recipient instead (e.g. "for Baby Showers", "for New Parents", "for Toddlers", "for Kids").
  • Promotional / price: Best, Best Seller, Bestseller, #1, Top Rated, Cheap, Cheapest, Best Price, Lowest Price, Sale, On Sale, Flash Sale, Discount, Deal, Coupon, Bargain, Free Shipping.
  • Urgency: Limited Time, Today Only, Last Chance, While Supplies Last, Buy Now.
  • Guarantee / claims: Guaranteed, 100% Guaranteed, Risk-Free, Money Back, Lifetime Guarantee, Award-Winning, FDA Approved, Doctor Approved, Expert Approved, Clinically Proven.
  • Eco / safety claims: Eco-Friendly, Non-Toxic, Chemical Free, Biodegradable, Sustainable, 100% Safe, Child-Safe (these belong nowhere unless in source facts).
  Specific banned phrases seen in this niche — never output: "Baby Shower Gift", "Shower Gift", "Best Gift", "Perfect Gift", "Great Gift", "Ideal Gift".
  • NO WORD MORE THAN TWICE (Amazon blocks this — code 100470): no single word may appear more than TWO times in the whole title, counting case-insensitively. This applies to EVERY word including the occasion/theme word (e.g. "Christmas", "Birthday"), "Book", "Story", "Kids", "Name", "Custom", "for". Before finishing, scan your title and if any word appears 3+ times, rephrase to remove the extra repeats (use a synonym or drop it) — e.g. don't write "Christmas … Christmas … Christmas"; keep the theme word to at most twice. Also keep the title non-redundant: do not restate the same idea twice, stay within 200 characters.
- "bullets": array of EXACTLY 5 bullet points, each 150-230 characters. Each starts with a 2-4 word ALL-CAPS hook then an em dash, e.g. "PERSONALIZED JUST FOR THEM — ...". Cover in order: (1) what is personalized & how special it feels, (2) physical quality: pages/hardcover/printing, (3) who & occasions it's a gift for, (4) how easy customizing is (enter name, add messages, optional photo), (5) keepsake value / why families love it.
- "description": plain text, 900-1500 characters, 3-4 short paragraphs separated by a blank line. No HTML tags, no markdown. Warm, gift-focused, keyword-rich but natural. Do not repeat the bullets verbatim.

AMAZON POLICY — applies to ALL fields, violations get the listing suppressed: no shipping/delivery/turnaround promises, no price or discount talk, no warranty or guarantee wording, no reviews or "bestseller/top rated" claims, no website URLs / emails / phone numbers / social handles, no "eco-friendly", "non-toxic", "hypoallergenic" or safety claims unless stated in the source facts, no comparisons to other brands, no emojis or decorative symbols anywhere.

DO NOT SOUND LIKE A TOY — CRITICAL, applies to ALL fields (title, bullets, description). Amazon's system AUTO-classifies listings as a "children's toy" from the WORDING and REMOVES them, demanding ASTM F963-23 / CPSIA toy-safety compliance. This product is a printed HARDCOVER BOOK meant to be READ — never a toy to play with. NEVER frame it as a play, developmental, interactive, or sensory object, and never describe a baby physically playing with it. FORBIDDEN wording anywhere: "toy", "play", "playtime", "plaything", "point and explore", "babies point", "interactive", "developmental", "sensory", "educational toy", "learning toy", "first toy", "activity book", "grab / touch / hold / chew", "teether", "for babies to explore". INSTEAD always frame the child as a READER or listener of a story: use "read together", "read aloud", "illustrated storybook", "picture book", "keepsake story", "bedtime story", "story to treasure". You may still say it is for kids/children and name gentle occasions, but every field must read as a STORYBOOK / KEEPSAKE to read — not a plaything. Also avoid leaning on "baby / toddler / nursery / baby shower" as the main framing; prefer "child", "little one", "kids", "children".

DO NOT SOUND LIKE A BLANK / ACTIVITY BOOK — CRITICAL, applies to ALL fields. Amazon's system AUTO-reclassifies listings that read like a blank fill-it-yourself book into the BLANK_BOOK product type, which then demands an ISBN and breaks the listing. This is a FINISHED, ready-made illustrated storybook with a pre-designed story and full-color illustrations — the ONLY thing the customer adds is the child's name (and an optional short dedication). NEVER describe it as, or imply, any of: a "photo book", "photo album", "blank book", "blank pages", "fill-in", "write-your-own", "upload your own photos", "coloring book", "color it in", "activity book", "workbook", "journal", "notebook", "sketchbook", "diary", "scrapbook", "portfolio", or "memorial book". The pages are already illustrated and printed — do not suggest the buyer fills, colors, or writes them. Always frame it as a pre-illustrated personalized storybook / picture book / keepsake to be read. (Unless the PRODUCT BRIEF explicitly says the item genuinely is a coloring or activity book, in which case follow the brief.)

LENGTH RULE: every field must land inside its stated character range, spaces included. Check each before writing it out — add a real detail when short, cut the weakest words when long. Output the JSON object only.`;

const clip = (s: string | null | undefined, n: number) => String(s ?? "").trim().slice(0, n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const IMG_MAX = 3;
function imgUrls(v: unknown): string[] {
  const arr = (Array.isArray(v) ? v : []) as { src?: string; position?: number }[];
  return arr.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99))
    .map((i) => String(i?.src ?? "").trim())
    .filter((s) => /^https:\/\//i.test(s))
    .slice(0, IMG_MAX)
    .map((s) => s + (s.includes("?") ? "&" : "?") + "width=900");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function askAI(user: string, model: string | undefined, deadline: number, images?: string[]): Promise<Out> {
  let last: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const left = deadline - Date.now();
    if (left < 8000) break;
    try {
      const o = await orChatJSON<Out>(SYSTEM, user, { model, maxTokens: 8000, temperature: 0.5, reasoning: "low", images, timeoutMs: Math.min(45000, left - 2000) });
      if (!clip(o?.amazonTitle, 250)) throw new Error("model trả về amazonTitle rỗng");
      if (!Array.isArray(o?.bullets) || o.bullets.filter((b) => clip(b, 300)).length < 5) throw new Error("model trả thiếu bullets");
      return o;
    } catch (e) {
      last = e as Error;
      const m = String(last?.message ?? "");
      if (/HTTP 4(0[13]|04)/.test(m)) break;
      const rate = /429|rate.?limit|too many/i.test(m);
      const wait = rate ? 4000 : 1200;
      if (deadline - Date.now() < wait + 10000) break;
      await sleep(wait);
    }
  }
  throw last ?? new Error("hết thời gian trong 1 request — bấm Retry failed");
}

export async function POST(req: NextRequest) {
  const deadline = Date.now() + BUDGET_MS;
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, MAX_PER_CALL);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  const model = typeof b?.model === "string" && b.model.trim() ? b.model.trim() : undefined;

  const rows = await db.select({
    id: schema.amazonProducts.id,
    srcTitle: schema.shopifyProducts.title, srcTags: schema.shopifyProducts.tags,
    srcBody: schema.shopifyProducts.bodyHtml, srcType: schema.shopifyProducts.productType,
    srcImages: schema.shopifyProducts.images,
    amazonTemplateId: schema.amazonProducts.amazonTemplateId, manualType: schema.amazonProducts.manualType,
    seller: schema.stores.sellerId,
  }).from(schema.amazonProducts)
    .leftJoin(schema.shopifyProducts, eq(schema.shopifyProducts.id, schema.amazonProducts.shopifyProductId))
    .leftJoin(schema.stores, eq(schema.stores.id, schema.amazonProducts.storeId))
    .where(inArray(schema.amazonProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // v359 · brief sản phẩm theo TEMPLATE (giống tplFor bên listing-file) → đưa vào prompt làm ngữ cảnh có thẩm quyền.
  const tpls = await db.select().from(schema.amazonTemplates);
  const briefFor = (amazonTemplateId: string | null, productType: string | null): string => {
    let t = amazonTemplateId ? tpls.find((x) => x.id === amazonTemplateId) : undefined;
    if (!t) { const pt = (productType ?? "").trim().toLowerCase(); if (pt) t = tpls.find((x) => (x.productType ?? "").trim().toLowerCase() === pt); }
    if (!t && tpls.length === 1) t = tpls[0];
    return String((t?.config as { aiBrief?: string } | undefined)?.aiBrief ?? "").trim();
  };

  const results = await Promise.all(rows.map(async (r, idx): Promise<{ id: string; ok: boolean; title?: string; bullets?: string[]; description?: string; error?: string }> => {
    try {
      if (!r.srcTitle) throw new Error("listing Shopify nguồn không còn — gỡ bản ghi này và push lại");
      await sleep(idx * 400); // lệch pha tránh 429
      const brief = briefFor(r.amazonTemplateId, r.srcType || r.manualType);
      const user = [
        brief ? `PRODUCT BRIEF — AUTHORITATIVE. This describes what the product ACTUALLY is; follow it over the source listing wherever they conflict, and never contradict it:\n${clip(brief, 2000)}\n` : "",
        `SOURCE LISTING TITLE: ${clip(r.srcTitle, 300)}`,
        r.srcType ? `PRODUCT TYPE: ${clip(r.srcType, 100)}` : "",
        r.srcTags ? `TAGS: ${clip(r.srcTags, 400)}` : "",
        r.srcBody ? `SOURCE DESCRIPTION: ${clip(stripHtml(r.srcBody), 1800)}` : "",
        `CUSTOMIZATION AVAILABLE: child's first name, message for first page, message for last page, gift-from line, optional photo upload, optional character hair & skin option.`,
      ].filter(Boolean).join("\n");

      const out = await askAI(user, model, deadline, imgUrls(r.srcImages));
      const title = clip(out.amazonTitle, 250);
      const bullets = (out.bullets ?? []).map((x) => clip(x, 300)).filter(Boolean).slice(0, 5);
      const description = clip(out.description, 2500);

      await db.update(schema.amazonProducts)
        .set({ title, bullets, description, aiAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.amazonProducts.id, r.id));
      return { id: r.id, ok: true, title, bullets, description };
    } catch (e) {
      return { id: r.id, ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) };
    }
  }));

  return NextResponse.json({ ok: true, results });
}
