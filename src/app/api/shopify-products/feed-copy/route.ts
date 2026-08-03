import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { orChatJSON } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
// Vercel PRO ⇒ 300s. Hạ về Hobby thì phải đưa maxDuration = 60 và BUDGET_MS = 52_000.
export const maxDuration = 300;
const BUDGET_MS = 270_000;

/**
 * POST /api/shopify-products/feed-copy { ids, model? }
 *
 * Viết feed_title + feed_description cho SUPPLEMENTAL FEED của Merchant Center.
 * KHÔNG ghi lên Shopify, KHÔNG set dirty — 2 field này chỉ nằm trong FUSION OS và
 * chỉ đi ra ngoài qua nút Export Google feed.
 *
 * Vì sao phải tách khỏi SEO meta description:
 *   - ô SEO meta là dòng snippet trên Google Search, quá 155 ký tự là bị cắt ⇒ phải ngắn.
 *   - feed Merchant Center cho description tới 5000 ký tự, và description là tín hiệu chính
 *     để Google match query cho cả Free listings lẫn Shopping ⇒ càng đủ ý càng tốt.
 * Feed phụ ghi đè giá trị feed mà không đụng listing, nên hai chỗ được viết khác nhau.
 *
 * feed_title cũng tự sửa luôn cái đuôi variant (8"x8" / Matte) mà Shopify tự nối vào title feed.
 */
const MAX_PER_CALL = 6;
const T_MAX = 150;    // Google cắt title feed ở 150
const D_MIN = 600;
const D_MAX = 1400;

const SYSTEM = `You write Google Merchant Center feed copy for a print-on-demand personalized product sold in the United States. This copy is read by Google's matching engine and by shoppers on Google Shopping and Free listings — not by a search-results snippet, so there is room to be complete.

Return STRICT JSON with exactly two keys:

- "feedTitle": 110-150 characters written as ONE natural product name a real store would print on a shelf label — NOT a comma-separated keyword list. Aim for two to three descriptive segments joined by commas at most, each reading as normal English (e.g. "Personalized Raccoon Story Book for Kids with Their Name and Photos, Woodland Watercolor Hardcover Keepsake Gift"). Start with the primary keyword a buyer actually types, then the recipient, the occasion, and the concrete product form (e.g. hardcover photo book). Use Title Case, but keep short words lowercase unless they are the first word: for, and, with, to, of, in, on, a, an, the, or. No variant suffix, no size, no paper finish, no shop name, no ALL CAPS, no emojis, no pipe characters, no filler words padded on to hit the length.

- "feedDescription": 800-1200 characters of PLAIN TEXT — no HTML tags, no bullet characters, no line breaks, no emojis. Write 4-6 flowing sentences that a shopper would actually read, covering, in this order: what the product is and who it is for; how the personalization works in concrete detail — exactly what the buyer supplies (name, photos, dedication, whatever the facts state), how it appears inside the book, and why that makes it a one-of-a-kind keepsake rather than a generic gift; the physical specifics (format, cover, paper, page count, print quality) exactly as given in the facts below; and the gift occasions and recipients it suits. Weave in the natural phrases buyers search — occasion, recipient, product type, style — as part of real sentences. NEVER mention shipping, delivery, production time, turnaround, arrival dates, returns or any policy — the Merchant Center feed carries those separately and stating them here creates a mismatch. Never list keywords, never repeat a phrase, never invent a number, size, material, time or policy that is not in the input.`;

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Feed không chấp nhận HTML/xuống dòng/tab — dọn sạch trước khi lưu để lúc Export khỏi phải xử lý.
const plain = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();

type Tpl = typeof schema.shopifyTemplates.$inferSelect;
function tplFor(tpls: Tpl[], storeId: string, productType: string | null, pinnedId: string | null): Tpl | null {
  if (pinnedId) { const p = tpls.find((t) => t.id === pinnedId); if (p) return p; }
  const list = tpls.filter((t) => t.storeId === storeId);
  const pt = (productType ?? "").trim().toLowerCase();
  if (pt) { const byType = list.find((t) => (t.productType ?? "").trim().toLowerCase() === pt); if (byType) return byType; }
  const active = list.filter((t) => t.status === "ACTIVE");
  if (active.length === 1) return active[0];
  return list.length === 1 ? list[0] : null;
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
    id: schema.shopifyProducts.id, storeId: schema.shopifyProducts.storeId, title: schema.shopifyProducts.title,
    bodyHtml: schema.shopifyProducts.bodyHtml, tags: schema.shopifyProducts.tags, productType: schema.shopifyProducts.productType,
    seoDescription: schema.shopifyProducts.seoDescription, options: schema.shopifyProducts.options,
    templateId: schema.shopifyProducts.templateId, seller: schema.stores.sellerId,
  }).from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  if (!rows.length) return NextResponse.json({ ok: false, error: "không tìm thấy sản phẩm" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const tpls = await db.select().from(schema.shopifyTemplates);

  const results = await Promise.all(rows.map(async (r, idx): Promise<{ id: string; title: string; ok: boolean; chars?: number; error?: string }> => {
    try {
      await sleep(idx * 400);
      if (deadline - Date.now() < 20000) throw new Error("hết thời gian trong 1 request — bấm Retry failed");
      const tpl = tplFor(tpls, r.storeId, r.productType, r.templateId);
      const opts = (Array.isArray(r.options) ? r.options as { name: string; values: string[] }[] : []).map((o) => `${o.name}: ${(o.values ?? []).join(", ")}`).join(" | ");

      const user = `Current product title: ${clip(r.title, 200)}
Product type: ${clip(r.productType, 80)}
Variants offered: ${opts || "none"}
Search terms buyers use: ${clip(r.tags, 400)}
Current meta description: ${clip(r.seoDescription, 200) || "(none)"}

SUPPLIER FACTS (ground truth — never contradict, never invent beyond this):
[Product info] ${clip(tpl?.baseDescription, 1500) || "(none)"}
[Specs] ${clip(tpl?.productDetails, 1500) || "(none)"}

Current on-page description (plain, up to 2000 chars): ${plain(r.bodyHtml).slice(0, 2000)}`;

      const o = await orChatJSON<{ feedTitle?: string; feedDescription?: string }>(SYSTEM, user, {
        // 1600 đủ cho model thường (feed dài nhất ~1400 ký tự ≈ 400 token) nhưng model suy luận
        // (GPT-5.x…) đốt hết vào phần nghĩ ⇒ content rỗng finish_reason=length. Nới trần + effort low.
        model, maxTokens: 8000, temperature: 0.5, reasoning: "low",
        timeoutMs: Math.min(70_000, Math.max(15_000, deadline - Date.now() - 8000)),
      });
      const ft = clip(plain(o?.feedTitle), T_MAX);
      const fd = clip(plain(o?.feedDescription), D_MAX);
      if (!ft) throw new Error("model trả về feedTitle rỗng");
      // Dưới 600 ký tự là hỏng mục đích của việc này (đang có 140) ⇒ báo fail để chạy lại, không lưu bản cụt.
      if (fd.length < D_MIN) throw new Error(`feedDescription chỉ ${fd.length} ký tự (cần ≥${D_MIN}) — bấm Retry failed`);

      await db.update(schema.shopifyProducts)
        .set({ feedTitle: ft, feedDescription: fd, feedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.shopifyProducts.id, r.id));
      return { id: r.id, title: r.title, ok: true, chars: fd.length };
    } catch (e) {
      return { id: r.id, title: r.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 240) };
    }
  }));

  const done = results.filter((x) => x.ok).length;
  const chars = results.filter((x) => x.ok).map((x) => x.chars ?? 0);
  return NextResponse.json({
    ok: done > 0, written: done, failed: results.length - done,
    avgChars: chars.length ? Math.round(chars.reduce((a, c) => a + c, 0) / chars.length) : 0,
    results,
  });
}
