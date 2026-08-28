import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { orChatJSON } from "@/lib/ai/openrouter";
import { getPrompt } from "@/lib/ai/prompt-store";

export const dynamic = "force-dynamic";
// Tài khoản đang ở gói Vercel PRO ⇒ maxDuration tối đa 300s (Hobby mới bị chặn ở 60s).
// Nếu sau này hạ về Hobby thì PHẢI đưa 3 số dưới đây về 60 / 52_000 / 3, không thì cả lô chết câm.
export const maxDuration = 300;
const BUDGET_MS = 270_000; // tự trả kết quả trước khi Vercel giết function

/**
 * POST /api/shopify-products/ai-optimize { ids, model? }
 * Template = NGUỒN FACTS chung từ supplier. Ưu tiên template ĐƯỢC GÁN (product.templateId),
 * không có thì tự khớp theo Product type (cùng store).
 * AI đọc facts + nội dung listing → TỰ VIẾT cả 3 phần cho riêng listing đó:
 *   <h5>Description</h5> (bài bán hàng) + <h5>Product Details</h5> (bullet specs) + <h5>Shipping</h5>
 * — theme (Gecko/The4) tách <h5> thành 3 tab như Flagwix.
 * Không có template → chỉ gen Description như trước.
 *
 * QUAN TRỌNG (fix "chỉ chạy được 1 sản phẩm"):
 * Mỗi request nhận TỐI ĐA 6 ids và chạy SONG SONG, có ngân sách thời gian riêng để LUÔN
 * kịp trả JSON trước mốc 300s của Vercel Pro. Bản cũ nhận 20 ids chạy tuần tự → bị giết sau con đầu tiên.
 * Client tự chia lô 6, hiện tiến độ, và tự chạy lại những con fail.
 * Không nâng quá 6: mỗi id = 1 request OpenRouter, bắn nhiều quá dễ dính rate limit 429.
 */
const MAX_PER_CALL = 6;

type Opt = { title?: string; seoTitle?: string; seoDescription?: string; tags?: string; description?: string; productDetails?: string; shipping?: string };

// Prompt sống ở src/lib/ai/prompt-defs.ts (id "shopify.optimize.base" + "shopify.optimize.tplExtra") — sửa qua Manager Prompts.

type Tpl = typeof schema.shopifyTemplates.$inferSelect;
// Template cho product: ưu tiên template ĐƯỢC GÁN → khớp Type (case-insensitive) → template ACTIVE duy nhất / duy nhất của store.
function tplFor(tpls: Tpl[], storeId: string, productType: string | null, pinnedId: string | null): Tpl | null {
  if (pinnedId) { const p = tpls.find((t) => t.id === pinnedId); if (p) return p; }
  const list = tpls.filter((t) => t.storeId === storeId);
  const pt = (productType ?? "").trim().toLowerCase();
  if (pt) {
    const byType = list.find((t) => (t.productType ?? "").trim().toLowerCase() === pt);
    if (byType) return byType;
  }
  const active = list.filter((t) => t.status === "ACTIVE");
  if (active.length === 1) return active[0];
  if (list.length === 1) return list[0];
  return null;
}
const clip = (s: string | null | undefined, n: number) => String(s ?? "").trim().slice(0, n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Gọi AI trong NGÂN SÁCH thời gian còn lại. Lý do fail hay gặp khi chạy song song:
 *  - 429 rate limit của OpenRouter (nhất là model :free) → chờ ngắn rồi thử lại nếu còn giờ
 *  - 5xx / provider chậm → thử lại
 *  - JSON cụt vì hết max_tokens → orChatJSON đã tự vá, còn hỏng thì thử lại
 * Chỉ thử lại KHI còn đủ thời gian; hết giờ thì trả lỗi rõ ràng để client tự chạy lại con đó.
 */
// Ảnh sản phẩm gửi kèm cho model NHÌN. Mỗi listing cá nhân hoá một kiểu (ảnh khách gửi, tên in bìa,
// nhân vật riêng…) và template KHÔNG mô tả nổi từng kiểu, nên chữ nghĩa suông hay viết chung chung.
// Lấy tối đa 3 ảnh đầu theo position (bìa + ruột) và ép Shopify CDN trả bản 900px cho nhẹ token.
const IMG_MAX = 3;
function imgUrls(v: unknown): string[] {
  const arr = (Array.isArray(v) ? v : []) as { src?: string; position?: number }[];
  return arr.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99))
    .map((i) => String(i?.src ?? "").trim())
    .filter((s) => /^https:\/\//i.test(s))
    .slice(0, IMG_MAX)
    .map((s) => s + (s.includes("?") ? "&" : "?") + "width=900");
}

async function askAI(system: string, user: string, model: string | undefined, deadline: number, images?: string[]): Promise<Opt> {
  let last: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const left = deadline - Date.now();
    if (left < 8000) break;
    try {
      // Model suy luận tiêu token nghĩ TRONG max_tokens ⇒ 4000 cạn trước khi kịp viết JSON
      // (lỗi "nội dung rỗng, finish_reason=length"). Nới trần + ép effort low: chỉ viết copy, không cần nghĩ sâu.
      const o = await orChatJSON<Opt>(system, user, { model, maxTokens: 12000, temperature: 0.5, reasoning: "low", images, timeoutMs: Math.min(45000, left - 2000) });
      if (!clip(o?.title, 120)) throw new Error("model trả về title rỗng");
      return o;
    } catch (e) {
      last = e as Error;
      const m = String(last?.message ?? "");
      if (/HTTP 4(0[13]|04)/.test(m)) break;                       // sai key / hết credit / model không tồn tại → thử lại vô ích
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

  const rows = await db.select({ id: schema.shopifyProducts.id, storeId: schema.shopifyProducts.storeId, title: schema.shopifyProducts.title, tags: schema.shopifyProducts.tags, bodyHtml: schema.shopifyProducts.bodyHtml, productType: schema.shopifyProducts.productType, vendor: schema.shopifyProducts.vendor, options: schema.shopifyProducts.options, images: schema.shopifyProducts.images, gid: schema.shopifyProducts.shopifyProductId, templateId: schema.shopifyProducts.templateId, seller: schema.stores.sellerId })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const storeIds = Array.from(new Set(rows.map((r) => r.storeId)));
  const tpls = storeIds.length ? await db.select().from(schema.shopifyTemplates) : [];

  // Listing Etsy GỐC của sản phẩm này (nối bằng GID Shopify đã ghi lúc Push).
  // Đây là nơi DUY NHẤT nói rõ listing này cá nhân hoá cái gì — template chỉ tả chung cho cả loại.
  const gids = rows.map((r) => r.gid).filter(Boolean) as string[];
  const srcRows = gids.length
    ? await db.select({ gid: schema.etsyProducts.shopifyProductId, title: schema.etsyProducts.title, tags: schema.etsyProducts.tags, description: schema.etsyProducts.description })
        .from(schema.etsyProducts).where(inArray(schema.etsyProducts.shopifyProductId, gids))
    : [];
  const srcBy = new Map(srcRows.filter((s) => s.gid).map((s) => [s.gid as string, s]));

  // Prompt (admin có thể ghi đè qua Manager Prompts) — lấy 1 lần cho cả lô.
  const promptBase = await getPrompt("shopify.optimize.base");
  const promptExtra = await getPrompt("shopify.optimize.tplExtra");

  // Chạy SONG SONG — mỗi sản phẩm tự bắt lỗi, 1 con hỏng không kéo cả lô.
  const results = await Promise.all(rows.map(async (r, idx): Promise<{ id: string; title: string; ok: boolean; withTemplate?: boolean; error?: string }> => {
    try {
      await sleep(idx * 400); // lệch pha — 3 request nổ cùng lúc rất dễ ăn 429
      const tpl = tplFor(tpls, r.storeId, r.productType, r.templateId);
      const hasFacts = !!(tpl && ((tpl.baseDescription ?? "").trim() || (tpl.productDetails ?? "").trim() || (tpl.shippingInfo ?? "").trim()));
      const opts = (Array.isArray(r.options) ? r.options as { name: string; values: string[] }[] : []).map((o) => `${o.name}: ${(o.values ?? []).join(", ")}`).join(" | ");

      const factsBlock = hasFacts ? `
SUPPLIER FACTS (ground truth for this product type "${tpl!.productType ?? ""}"):
[Product info] ${clip(tpl!.baseDescription, 1500) || "(none)"}
[Specs] ${clip(tpl!.productDetails, 1500) || "(none)"}
[Shipping] ${clip(tpl!.shippingInfo, 1500) || "(none)"}
` : "";
      const src = r.gid ? srcBy.get(r.gid) : undefined;
      const srcBlock = src ? `
SOURCE LISTING this product was built from. The source title is the most accurate single description of what this specific listing is and what gets personalized — trust it over the generic facts below. Use it ONLY to understand the product; never reuse its sentences, its exact title, or any policy/shipping text from it:
[Source title] ${clip(src.title, 250)}
[Source tags] ${clip(src.tags, 400)}
[Source description] ${clip(src.description, 1800)}
` : "";
      const user = `Current title: ${r.title}
Product type: ${r.productType ?? ""}
Vendor/brand: ${r.vendor ?? ""}
Options/variants: ${opts || "none"}
Current tags: ${r.tags ?? ""}
${srcBlock}${factsBlock}Current description (plain, up to 1000 chars): ${(r.bodyHtml ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000)}`;

      const system = hasFacts ? promptBase + promptExtra : promptBase;
      const o = await askAI(system, user, model, deadline, imgUrls(r.images));
      const t = clip(o?.title, 120);

      // Ghép 3 tab — tất cả do AI viết riêng cho listing này (facts từ template)
      let body = clip(o?.description, 6000);
      const det = hasFacts ? clip(o?.productDetails, 3000) : "";
      const shp = hasFacts ? clip(o?.shipping, 3000) : "";
      let usedTpl = false;
      if (body && (det || shp)) {
        body = `<h5>Description</h5>\n${body}`;
        if (det) body += `\n<h5>Product Details</h5>\n${det}`;
        if (shp) body += `\n<h5>Shipping</h5>\n${shp}`;
        usedTpl = true;
      }

      await db.update(schema.shopifyProducts).set({
        title: t,
        seoTitle: clip(o?.seoTitle, 70) || null,
        seoDescription: clip(o?.seoDescription, 320) || null,
        tags: clip(o?.tags, 600) || r.tags,
        bodyHtml: body.slice(0, 12000) || r.bodyHtml,
        dirty: true, aiAt: new Date(), updatedAt: new Date(),
      }).where(eq(schema.shopifyProducts.id, r.id));
      return { id: r.id, title: r.title, ok: true, withTemplate: usedTpl };
    } catch (e) {
      return { id: r.id, title: r.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 240) };
    }
  }));

  const done = results.filter((r) => r.ok).length;
  const withTpl = results.filter((r) => r.withTemplate).length;
  const errors = results.filter((r) => !r.ok).map((r) => r.error!).slice(0, 3);
  return NextResponse.json({ ok: done > 0, optimized: done, withTemplate: withTpl, total: rows.length, failed: results.length - done, results, errors: errors.length ? errors : undefined });
}
