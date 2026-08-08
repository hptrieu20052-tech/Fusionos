import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { hitsSummary, type PolicyHit } from "@/lib/policy-scan";
import { orChatJSON } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/shopify-products/policy-ai { ids, model? }
 *
 * v179 · AI POLICY AUDIT — phân tích TOÀN BỘ listing bằng model 👁 người dùng chọn:
 *   ảnh (artwork) + title + description + tags + SEO title + SEO meta + Google feed title/description.
 * Trả về từng vấn đề: nằm ở đâu, nặng nhẹ, và CẦN SỬA THẾ NÀO (fix cụ thể, dùng được ngay).
 *
 * Phạm vi soi (v188 · đa sàn — mọi kênh catalog này chảy tới):
 *   - Trademark/IP: thương hiệu, nhân vật có bản quyền, likeness nghệ sĩ/người nổi tiếng — cả trong
 *     ARTWORK lẫn text (kể cả viết lái/che chữ).
 *   - Google Shopping/GMC: chữ khuyến mãi trong title/feed title ("free shipping", "sale", "% off"),
 *     ALL CAPS, số điện thoại/URL nhét trong text, claim y tế, "officially licensed" không có license,
 *     replica/dupe, claim tuyệt đối gian dối; ẢNH có chữ khuyến mãi đè lên / watermark (GMC disapprove).
 *   - Meta (FB/IG Shops & ads): câu chữ khẳng định/ám chỉ đặc điểm cá nhân của người mua/người nhận
 *     (bệnh lý, tôn giáo, chủng tộc, tài chính — "for your autistic son"...), claim before/after,
 *     nội dung gợi dục.
 *   - Pinterest shopping: clickbait/thúc ép quá đà ("you won't believe", "miracle", "last chance"),
 *     nhét contact info vào description, giá/tồn kho ghi trong text không khớp listing.
 *   - SEO fields: meta/feed sai bản chất sản phẩm (misrepresentation), nhồi từ khoá lộ liễu.
 *   - KHÔNG flag sản phẩm tôn giáo (Bible/baptism hợp lệ trên mọi sàn — chỉ bị Limited personalized
 *     ads, không phải vi phạm) — tránh báo láo trên đúng dòng hàng chủ lực.
 *
 * Kết quả GHI ĐÈ policy_risk/policy_hits (nguồn sự thật duy nhất). HIGH → nút Push chặn cho tới khi
 * sửa xong và chạy lại audit ra sạch. AI là máy sàng lọc, không phải luật sư — người duyệt cuối.
 */
const MAX_PER_CALL = 6;
const IMG_MAX = 3;
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function imgUrls(v: unknown): string[] {
  const arr = (Array.isArray(v) ? v : []) as { src?: string; position?: number }[];
  return arr.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99))
    .map((i) => String(i?.src ?? "").trim())
    .filter((s) => /^https:\/\//i.test(s))
    .slice(0, IMG_MAX)
    .map((s) => s + (s.includes("?") ? "&" : "?") + "width=900");
}

const FIELDS = ["title", "description", "tags", "seo_title", "seo_description", "feed_title", "feed_description", "image", "other"] as const;

const SYSTEM = `You audit ONE e-commerce product listing for trademark/IP and marketplace-policy risks across EVERY channel this catalog feeds: Shopify, Google Shopping / Google Merchant Center, Meta (Facebook & Instagram Shops and ads), Pinterest shopping, TikTok Shop. A finding on ANY of these platforms counts. THE PRODUCT IMAGES ARE ATTACHED — EXAMINE THEM FIRST, then every text field provided.

Check EVERY part of the listing:
- image (artwork): recognizable copyrighted characters (Disney/Pixar/Marvel/Nintendo/anime/kids-show characters), brand logos or wordmarks, celebrity or musician likenesses, or artwork clearly imitating one specific franchise's distinctive style. Generic princesses/superheroes/animals and original characters are FINE. Also (GMC & Pinterest image rules): promotional text overlaid on product images ("SALE", "Free shipping"), watermarks, phone numbers or URLs burned into the image.
- title, tags, description: protected brand/franchise/band/celebrity names — including leetspeak or masked spellings (B4ckstreet, Tr**p); "officially licensed"/"authentic" without a license; replica/dupe/counterfeit language; medical or absolute claims ("cures", "FDA approved", "#1 best seller").
- title and feed_title (Google Shopping rules): promotional text does NOT belong in titles — "free shipping", "sale", "% off", "best price"; no ALL-CAPS words, no phone numbers, no URLs, no emoji.
- seo_title, seo_description, feed_description: same brand/claim rules; also flag if they misrepresent what the product actually is (mismatch vs the images), or obvious keyword stuffing.
- Meta commerce rules (any text field): wording that asserts or implies personal attributes of the buyer or recipient — a medical/mental condition (ADHD, autism, anxiety...), religion, race, sexual orientation, or financial status ("for your autistic son" → suggest a neutral rewrite like "for kids who love..."); before/after transformation claims; sexualized content on any product.
- Pinterest merchant rules (any text field): clickbait or exaggerated urgency ("you won't believe", "miracle", "act now", "last chance"), contact info or off-platform CTAs in descriptions, price or availability claims in text that contradict the listing.

Do NOT flag: religious or faith-based products themselves — Bible storybooks, baptism gifts and similar are allowed on all these platforms (belief-related content merely limits personalized-ads eligibility on Google; that is a platform status, NOT a violation). Mentioning the product's own religious theme is fine; only flag wording that asserts the BUYER's/recipient's beliefs as a personal attribute.

For EACH problem found, return an object:
  {"issue":"<short, concrete — name the exact word/element>","where":"<one of: title|description|tags|seo_title|seo_description|feed_title|feed_description|image|other>","severity":"high"|"medium","fix":"<the exact, actionable correction — e.g. the replacement wording, or 'replace the cover artwork: character X is recognizable'>"}

severity high = clearly identifiable protected brand/character/person, or a claim that risks account suspension. severity medium = risky-but-ambiguous (style close to a franchise, promo wording, stuffing).

Be conservative and evidence-based; do not invent findings; empty fields are not problems. If the whole listing is clean, findings = [].

LANGUAGE (v192): write the "issue" and "fix" texts in VIETNAMESE — the review team reads Vietnamese. BUT keep every quoted term, brand/character name, and every exact replacement wording in its original ENGLISH inside quotation marks, because the listing itself stays in English and the team will copy-paste those exact English words. Example fix: Thay cụm "The personalized photo book" bằng "The personalized illustrated storybook". Example issue: Ảnh thứ 2 và 3 có chữ quảng cáo đè lên sản phẩm: "THE PERFECT FAMILY GIFT", "Add your Name".

Return STRICT JSON: {"risk":"clean"|"medium"|"high","findings":[...]}. risk = highest severity present (clean when none).`;

export async function POST(req: NextRequest) {
  const deadline = Date.now() + 290_000;
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, MAX_PER_CALL);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  const model = typeof b?.model === "string" && b.model.trim() ? b.model.trim() : undefined;

  const rows = await db.select({
    id: schema.shopifyProducts.id, title: schema.shopifyProducts.title, body: schema.shopifyProducts.bodyHtml,
    tags: schema.shopifyProducts.tags, images: schema.shopifyProducts.images,
    seoTitle: schema.shopifyProducts.seoTitle, seoDescription: schema.shopifyProducts.seoDescription,
    feedTitle: schema.shopifyProducts.feedTitle, feedDescription: schema.shopifyProducts.feedDescription,
    productType: schema.shopifyProducts.productType, vendor: schema.shopifyProducts.vendor,
    seller: schema.stores.sellerId,
  }).from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const results = await Promise.all(rows.map(async (r, idx): Promise<{ id: string; title: string; ok: boolean; risk?: string; summary?: string; findings?: PolicyHit[]; error?: string }> => {
    try {
      await sleep(idx * 400); // lệch pha tránh 429
      const plain = (r.body ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const user = `LISTING FIELDS
title: ${clip(r.title, 250)}
tags: ${clip(r.tags, 500) || "(empty)"}
description: ${clip(plain, 1500) || "(empty)"}
seo_title: ${clip(r.seoTitle, 120) || "(empty)"}
seo_description: ${clip(r.seoDescription, 250) || "(empty)"}
feed_title: ${clip(r.feedTitle, 200) || "(empty)"}
feed_description: ${clip(r.feedDescription, 1500) || "(empty)"}
product_type: ${clip(r.productType, 80) || "(empty)"} · vendor: ${clip(r.vendor, 80) || "(empty)"}`;

      const o = await orChatJSON<{ risk?: string; findings?: { issue?: string; where?: string; severity?: string; fix?: string }[] }>(
        SYSTEM, user,
        { model, maxTokens: 3000, temperature: 0.2, reasoning: "low", images: imgUrls(r.images), timeoutMs: Math.min(45000, deadline - Date.now() - 2000) },
      );

      const findings: PolicyHit[] = (Array.isArray(o?.findings) ? o!.findings! : [])
        .map((f) => ({
          term: clip(f?.issue, 160),
          field: (FIELDS.includes(String(f?.where) as typeof FIELDS[number]) ? f!.where : "other") as PolicyHit["field"],
          severity: (f?.severity === "high" ? "high" : "medium") as PolicyHit["severity"],
          fix: clip(f?.fix, 300) || undefined,
          src: "ai" as const,
        }))
        .filter((h) => h.term);

      const risk = findings.some((h) => h.severity === "high") || o?.risk === "high" ? "high"
        : findings.length || o?.risk === "medium" ? "medium" : "clean";

      await db.update(schema.shopifyProducts)
        .set({ policyRisk: risk, policyHits: findings, policyCheckedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.shopifyProducts.id, r.id));
      return { id: r.id, title: r.title, ok: true, risk, summary: findings.length ? hitsSummary(findings) : "", findings };
    } catch (e) {
      return { id: r.id, title: r.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) };
    }
  }));

  const clean = results.filter((r) => r.ok && r.risk === "clean").length;
  const medium = results.filter((r) => r.ok && r.risk === "medium").length;
  const high = results.filter((r) => r.ok && r.risk === "high").length;
  const failed = results.filter((r) => !r.ok).length;
  return NextResponse.json({ ok: results.some((r) => r.ok), checked: results.length, clean, medium, high, failed, results });
}
