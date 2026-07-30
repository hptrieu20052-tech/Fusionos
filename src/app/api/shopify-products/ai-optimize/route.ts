import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { orChatJSON } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/shopify-products/ai-optimize { ids, model? }
 * AI SEO: viết lại title + SEO meta (page title/meta description) + tags + description HTML có bố cục
 * → lưu local + dirty (Push đẩy cả seo.title/seo.description lên Shopify).
 */
type Opt = { title?: string; seoTitle?: string; seoDescription?: string; tags?: string; description?: string };
const SYSTEM = `You are an e-commerce SEO copywriter optimizing a Shopify product for US shoppers on Google Search & Shopping. Pick ONE primary keyword (what a buyer actually types) and weave it naturally into the title, the SEO fields, and the first sentence of the description. Never keyword-stuff, never invent specs/materials that aren't implied by the input, no emojis, no shop name.

Return STRICT JSON with these keys:
- "title": product title, 55-70 chars, primary keyword first, Title Case, human and specific (recipient + occasion + product type). No ALL CAPS.
- "seoTitle": SEO page title (what shows as the Google result link) MAX 60 chars, primary keyword near the front, compelling.
- "seoDescription": SEO meta description MAX 155 chars, one persuasive sentence with the keyword + a benefit + a soft call-to-action.
- "tags": 12-15 comma-separated lowercase search terms (recipient, occasion, product type, style, use-case). No underscores or #.
- "description": clean HTML, 150-250 words, structured EXACTLY as: one <p> hook (2-3 sentences, keyword in the first sentence); then <ul> with 4-6 <li> concrete benefits/features (personalization, occasions, quality, gifting); then one closing <p> with a gentle call to action. Use only <p>, <ul>, <li>, <strong>. No headings, no inline styles, no emojis.`;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 20);
  if (!ids.length) return NextResponse.json({ ok: false, error: "Select up to 20 products" }, { status: 400 });
  const model = typeof b?.model === "string" && b.model.trim() ? b.model.trim() : undefined;

  const rows = await db.select({ id: schema.shopifyProducts.id, title: schema.shopifyProducts.title, tags: schema.shopifyProducts.tags, bodyHtml: schema.shopifyProducts.bodyHtml, productType: schema.shopifyProducts.productType, vendor: schema.shopifyProducts.vendor, options: schema.shopifyProducts.options, seller: schema.stores.sellerId })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  let done = 0; const errors: string[] = [];
  for (const r of rows) {
    try {
      const opts = (Array.isArray(r.options) ? r.options as { name: string; values: string[] }[] : []).map((o) => `${o.name}: ${(o.values ?? []).join(", ")}`).join(" | ");
      const user = `Current title: ${r.title}
Product type: ${r.productType ?? ""}
Vendor/brand: ${r.vendor ?? ""}
Options/variants: ${opts || "none"}
Current tags: ${r.tags ?? ""}
Current description (plain, up to 1200 chars): ${(r.bodyHtml ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200)}`;
      const o = await orChatJSON<Opt>(SYSTEM, user, { model, maxTokens: 1400, temperature: 0.5, timeoutMs: 55000 });
      const t = String(o?.title ?? "").trim().slice(0, 120);
      if (!t) throw new Error("empty title");
      await db.update(schema.shopifyProducts).set({
        title: t,
        seoTitle: String(o?.seoTitle ?? "").trim().slice(0, 70) || null,
        seoDescription: String(o?.seoDescription ?? "").trim().slice(0, 320) || null,
        tags: String(o?.tags ?? "").trim().slice(0, 600) || r.tags,
        bodyHtml: String(o?.description ?? "").trim().slice(0, 4000) || r.bodyHtml,
        dirty: true, updatedAt: new Date(),
      }).where(eq(schema.shopifyProducts.id, r.id));
      done++;
    } catch (e) { if (errors.length < 3) errors.push(String((e as Error)?.message ?? e).slice(0, 120)); }
  }
  return NextResponse.json({ ok: true, optimized: done, total: rows.length, errors: errors.length ? errors : undefined });
}
