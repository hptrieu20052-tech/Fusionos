import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { orChatJSON } from "@/lib/ai/openrouter";
import { getPrompt } from "@/lib/ai/prompt-store";

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

// Prompt sống ở src/lib/ai/prompt-defs.ts (id "shopify.feedCopy") — admin sửa qua Manager Prompts.

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Feed không chấp nhận HTML/xuống dòng/tab — dọn sạch trước khi lưu để lúc Export khỏi phải xử lý.
const plain = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();

// Ảnh sản phẩm gửi kèm cho model NHÌN — mỗi listing cá nhân hoá một kiểu, template không tả nổi từng kiểu.
// Tối đa 3 ảnh đầu theo position, ép Shopify CDN trả bản 900px cho nhẹ token.
const IMG_MAX = 3;
function imgUrls(v: unknown): string[] {
  const arr = (Array.isArray(v) ? v : []) as { src?: string; position?: number }[];
  return arr.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99))
    .map((i) => String(i?.src ?? "").trim())
    .filter((s) => /^https:\/\//i.test(s))
    .slice(0, IMG_MAX)
    .map((s) => s + (s.includes("?") ? "&" : "?") + "width=900");
}

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
  const SYSTEM = await getPrompt("shopify.feedCopy"); // admin ghi đè qua Manager Prompts
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
    images: schema.shopifyProducts.images,
    gid: schema.shopifyProducts.shopifyProductId,
    templateId: schema.shopifyProducts.templateId, seller: schema.stores.sellerId,
  }).from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  if (!rows.length) return NextResponse.json({ ok: false, error: "không tìm thấy sản phẩm" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const tpls = await db.select().from(schema.shopifyTemplates);

  // Listing Etsy GỐC của sản phẩm này (nối bằng GID Shopify đã ghi lúc Push).
  // Đây là nơi DUY NHẤT nói rõ listing này cá nhân hoá cái gì — template chỉ tả chung cho cả loại.
  const gids = rows.map((r) => r.gid).filter(Boolean) as string[];
  const srcRows = gids.length
    ? await db.select({ gid: schema.etsyProducts.shopifyProductId, title: schema.etsyProducts.title, tags: schema.etsyProducts.tags, description: schema.etsyProducts.description })
        .from(schema.etsyProducts).where(inArray(schema.etsyProducts.shopifyProductId, gids))
    : [];
  const srcBy = new Map(srcRows.filter((s) => s.gid).map((s) => [s.gid as string, s]));

  const results = await Promise.all(rows.map(async (r, idx): Promise<{ id: string; title: string; ok: boolean; chars?: number; error?: string }> => {
    try {
      await sleep(idx * 400);
      if (deadline - Date.now() < 20000) throw new Error("hết thời gian trong 1 request — bấm Retry failed");
      const tpl = tplFor(tpls, r.storeId, r.productType, r.templateId);
      const opts = (Array.isArray(r.options) ? r.options as { name: string; values: string[] }[] : []).map((o) => `${o.name}: ${(o.values ?? []).join(", ")}`).join(" | ");

      // Title Etsy gốc là mô tả CHÍNH XÁC nhất về listing này: seller nhồi đủ ý vào đó
      // (cá nhân hoá cái gì, cho ai, dịp nào). Đưa lên đầu prompt để model bám vào.
      const src = r.gid ? srcBy.get(r.gid) : undefined;
      const srcBlock = src ? `
SOURCE LISTING this product was built from. The source title is the most accurate single description of what this specific listing is and what gets personalized — trust it over the generic facts below. Use it ONLY to understand the product; never reuse its sentences, its exact title, or any policy/shipping text from it:
[Source title] ${clip(src.title, 250)}
[Source tags] ${clip(src.tags, 400)}
[Source description] ${clip(src.description, 1800)}
` : "";

      const user = `Current product title: ${clip(r.title, 200)}
Product type: ${clip(r.productType, 80)}
Variants offered: ${opts || "none"}
Search terms buyers use: ${clip(r.tags, 400)}
Current meta description: ${clip(r.seoDescription, 200) || "(none)"}
${srcBlock}
SUPPLIER FACTS (ground truth — never contradict, never invent beyond this):
[Product info] ${clip(tpl?.baseDescription, 1500) || "(none)"}
[Specs] ${clip(tpl?.productDetails, 1500) || "(none)"}

Current on-page description (plain, up to 2000 chars): ${plain(r.bodyHtml).slice(0, 2000)}`;

      const o = await orChatJSON<{ feedTitle?: string; feedDescription?: string }>(SYSTEM, user, {
        // 1600 đủ cho model thường (feed dài nhất ~1400 ký tự ≈ 400 token) nhưng model suy luận
        // (GPT-5.x…) đốt hết vào phần nghĩ ⇒ content rỗng finish_reason=length. Nới trần + effort low.
        model, maxTokens: 8000, temperature: 0.5, reasoning: "low", images: imgUrls(r.images),
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
