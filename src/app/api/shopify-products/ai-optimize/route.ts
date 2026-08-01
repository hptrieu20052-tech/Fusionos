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
 * Template (khớp Type, cùng store) = NGUỒN FACTS chung từ supplier.
 * AI đọc facts + nội dung listing → TỰ VIẾT cả 3 phần cho riêng listing đó:
 *   <h5>Description</h5> (bài bán hàng) + <h5>Product Details</h5> (bullet specs) + <h5>Shipping</h5>
 * — theme (Gecko/The4) tách <h5> thành 3 tab như Flagwix.
 * Không có template → chỉ gen Description như trước.
 */
type Opt = { title?: string; seoTitle?: string; seoDescription?: string; tags?: string; description?: string; productDetails?: string; shipping?: string };

const SYSTEM_BASE = `You are an e-commerce SEO copywriter optimizing a Shopify product for US shoppers on Google Search & Shopping. Pick ONE primary keyword (what a buyer actually types) and weave it naturally into the title, the SEO fields, and the first sentence of the description. Never keyword-stuff, no emojis, no shop name.

Return STRICT JSON. Keys:
- "title": product title, 55-70 chars, primary keyword first, Title Case, human and specific (recipient + occasion + product type). No ALL CAPS.
- "seoTitle": SEO page title MAX 60 chars, primary keyword near the front, compelling.
- "seoDescription": SEO meta description MAX 155 chars, one persuasive sentence with the keyword + a benefit + a soft call-to-action.
- "tags": 12-15 comma-separated lowercase search terms (recipient, occasion, product type, style, use-case). No underscores or #.
- "description": clean HTML, 220-330 words: one <p> hook (keyword in first sentence, emotional benefit tied to THIS listing's theme); one <p> on how the personalization works / what makes it special; one <p><strong>Product features</strong></p> then <ul> with 5-7 <li> benefits; one <p> of gift occasions matching THIS listing's theme; one closing <p> call to action. Only <p>, <ul>, <li>, <strong>.`;

const SYSTEM_TPL_EXTRA = `

SUPPLIER FACTS are provided below — they are ground truth. Adapt wording to THIS listing's theme, but NEVER change or invent numbers, materials, sizes, times or policies. Also return:
- "productDetails": clean HTML for a "Product Details" tab — <ul> with 6-9 <li>, each "<strong>Label:</strong> value", built from the SUPPLIER FACTS specs and tailored to this listing (mention its theme where natural, e.g. the story/occasion). Keep every factual spec accurate.
- "shipping": clean HTML for a "Shipping" tab — a series of <p>, each starting "<strong>Label:</strong> ..." (Processing Time, Shipping Time (US), Shipping Time (International), Note, Shipping Cost, Tracking Number, Return & Exchange — include only those present in the facts). Copy all times, costs and policies EXACTLY from the facts; polish the wording only. Do not write about shipping inside "description".`;

type Tpl = typeof schema.shopifyTemplates.$inferSelect;
// Tìm template cho product: ưu tiên khớp Type (case-insensitive); fallback template ACTIVE duy nhất / template duy nhất của store.
function tplFor(tpls: Tpl[], storeId: string, productType: string | null): Tpl | null {
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

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 20);
  if (!ids.length) return NextResponse.json({ ok: false, error: "Select up to 20 products" }, { status: 400 });
  const model = typeof b?.model === "string" && b.model.trim() ? b.model.trim() : undefined;

  const rows = await db.select({ id: schema.shopifyProducts.id, storeId: schema.shopifyProducts.storeId, title: schema.shopifyProducts.title, tags: schema.shopifyProducts.tags, bodyHtml: schema.shopifyProducts.bodyHtml, productType: schema.shopifyProducts.productType, vendor: schema.shopifyProducts.vendor, options: schema.shopifyProducts.options, seller: schema.stores.sellerId })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const storeIds = Array.from(new Set(rows.map((r) => r.storeId)));
  const tpls = storeIds.length ? await db.select().from(schema.shopifyTemplates).where(inArray(schema.shopifyTemplates.storeId, storeIds)) : [];

  let done = 0; let withTpl = 0; const errors: string[] = [];
  for (const r of rows) {
    try {
      const tpl = tplFor(tpls, r.storeId, r.productType);
      const hasFacts = !!(tpl && ((tpl.baseDescription ?? "").trim() || (tpl.productDetails ?? "").trim() || (tpl.shippingInfo ?? "").trim()));
      const opts = (Array.isArray(r.options) ? r.options as { name: string; values: string[] }[] : []).map((o) => `${o.name}: ${(o.values ?? []).join(", ")}`).join(" | ");

      const factsBlock = hasFacts ? `
SUPPLIER FACTS (ground truth for this product type "${tpl!.productType ?? ""}"):
[Product info] ${clip(tpl!.baseDescription, 1500) || "(none)"}
[Specs] ${clip(tpl!.productDetails, 1500) || "(none)"}
[Shipping] ${clip(tpl!.shippingInfo, 1500) || "(none)"}
` : "";
      const user = `Current title: ${r.title}
Product type: ${r.productType ?? ""}
Vendor/brand: ${r.vendor ?? ""}
Options/variants: ${opts || "none"}
Current tags: ${r.tags ?? ""}
${factsBlock}Current description (plain, up to 1000 chars): ${(r.bodyHtml ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000)}`;

      const system = hasFacts ? SYSTEM_BASE + SYSTEM_TPL_EXTRA : SYSTEM_BASE;
      const o = await orChatJSON<Opt>(system, user, { model, maxTokens: 2600, temperature: 0.5, timeoutMs: 55000 });
      const t = clip(o?.title, 120);
      if (!t) throw new Error("empty title");

      // Ghép 3 tab — tất cả do AI viết riêng cho listing này (facts từ template)
      let body = clip(o?.description, 6000);
      const det = hasFacts ? clip(o?.productDetails, 3000) : "";
      const shp = hasFacts ? clip(o?.shipping, 3000) : "";
      if (body && (det || shp)) {
        body = `<h5>Description</h5>\n${body}`;
        if (det) body += `\n<h5>Product Details</h5>\n${det}`;
        if (shp) body += `\n<h5>Shipping</h5>\n${shp}`;
        withTpl++;
      }

      await db.update(schema.shopifyProducts).set({
        title: t,
        seoTitle: clip(o?.seoTitle, 70) || null,
        seoDescription: clip(o?.seoDescription, 320) || null,
        tags: clip(o?.tags, 600) || r.tags,
        bodyHtml: body.slice(0, 12000) || r.bodyHtml,
        dirty: true, updatedAt: new Date(),
      }).where(eq(schema.shopifyProducts.id, r.id));
      done++;
    } catch (e) { if (errors.length < 3) errors.push(String((e as Error)?.message ?? e).slice(0, 120)); }
  }
  return NextResponse.json({ ok: true, optimized: done, withTemplate: withTpl, total: rows.length, errors: errors.length ? errors : undefined });
}
