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
 * AI SEO có "nguồn sự thật": tự tìm Template cùng store khớp Type của product
 * → lấy baseDescription/productDetails/shippingInfo làm facts cho AI (mô tả dày, không bịa).
 * Description cuối = <h5>Description</h5>(AI) + <h5>Product Details</h5>(template) + <h5>Shipping</h5>(template)
 * — theme (Gecko/The4) tự tách các <h5> thành tab như Flagwix.
 */
type Opt = { title?: string; seoTitle?: string; seoDescription?: string; tags?: string; description?: string };

const SYSTEM = `You are an e-commerce SEO copywriter optimizing a Shopify product for US shoppers on Google Search & Shopping. Pick ONE primary keyword (what a buyer actually types) and weave it naturally into the title, the SEO fields, and the first sentence of the description. Never keyword-stuff, no emojis, no shop name.

If PRODUCT FACTS are provided, treat them as ground truth: use their concrete details (material, pages, personalization, sizes, who it's for) throughout the description. NEVER invent specs that contradict or go beyond the facts. Do NOT write about shipping, returns or a spec list — those sections are appended separately.

Return STRICT JSON with these keys:
- "title": product title, 55-70 chars, primary keyword first, Title Case, human and specific (recipient + occasion + product type). No ALL CAPS.
- "seoTitle": SEO page title MAX 60 chars, primary keyword near the front, compelling.
- "seoDescription": SEO meta description MAX 155 chars, one persuasive sentence with the keyword + a benefit + a soft call-to-action.
- "tags": 12-15 comma-separated lowercase search terms (recipient, occasion, product type, style, use-case). No underscores or #.
- "description": clean HTML, 230-350 words, structured EXACTLY as:
  1) one <p> hook (2-3 sentences, keyword in the first sentence, emotional benefit for the recipient);
  2) one <p> explaining how the personalization works / what makes this product special (use the facts);
  3) <ul> with 5-7 <li> concrete benefits drawn from the facts (personalization, quality, size choices, illustrations, keepsake value);
  4) one <p> listing gift occasions it fits (birthday, baptism, Christmas, baby shower… as appropriate);
  5) one closing <p> with a gentle call to action.
  Use only <p>, <ul>, <li>, <strong>. No headings, no inline styles, no emojis.`;

// ---- helpers: template text -> HTML tab sections ----
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const strongLabel = (line: string) => {
  const m = line.match(/^([^:]{2,48}):\s*(.*)$/);
  return m ? `<strong>${esc(m[1])}:</strong> ${esc(m[2])}` : esc(line);
};
const detailsHtml = (txt: string) => {
  const lines = txt.split(/\r?\n/).map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  return lines.length ? `<ul>${lines.map((l) => `<li>${strongLabel(l)}</li>`).join("")}</ul>` : "";
};
const shippingHtml = (txt: string) => {
  const paras = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return paras.map((l) => `<p>${strongLabel(l)}</p>`).join("");
};

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

  // Nạp template của các store liên quan (1 query)
  const storeIds = Array.from(new Set(rows.map((r) => r.storeId)));
  const tpls = storeIds.length ? await db.select().from(schema.shopifyTemplates).where(inArray(schema.shopifyTemplates.storeId, storeIds)) : [];

  let done = 0; let withTpl = 0; const errors: string[] = [];
  for (const r of rows) {
    try {
      const tpl = tplFor(tpls, r.storeId, r.productType);
      const opts = (Array.isArray(r.options) ? r.options as { name: string; values: string[] }[] : []).map((o) => `${o.name}: ${(o.values ?? []).join(", ")}`).join(" | ");
      const facts = tpl?.baseDescription?.trim() ?? "";
      const specs = tpl?.productDetails?.trim() ? tpl.productDetails.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join("; ") : "";
      const user = `Current title: ${r.title}
Product type: ${r.productType ?? ""}
Vendor/brand: ${r.vendor ?? ""}
Options/variants: ${opts || "none"}
Current tags: ${r.tags ?? ""}
${facts ? `PRODUCT FACTS (ground truth — use these details):\n${facts.slice(0, 1500)}\n` : ""}${specs ? `KEY SPECS: ${specs.slice(0, 800)}\n` : ""}Current description (plain, up to 1200 chars): ${(r.bodyHtml ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200)}`;
      const o = await orChatJSON<Opt>(SYSTEM, user, { model, maxTokens: 2000, temperature: 0.5, timeoutMs: 55000 });
      const t = String(o?.title ?? "").trim().slice(0, 120);
      if (!t) throw new Error("empty title");

      // Ghép mô tả 3 tab: Description (AI) + Product Details + Shipping (từ template, không cho AI bịa)
      let body = String(o?.description ?? "").trim();
      if (body && tpl) {
        const det = tpl.productDetails ? detailsHtml(tpl.productDetails) : "";
        const shp = tpl.shippingInfo ? shippingHtml(tpl.shippingInfo) : "";
        if (det || shp) {
          body = `<h5>Description</h5>\n${body}`;
          if (det) body += `\n<h5>Product Details</h5>\n${det}`;
          if (shp) body += `\n<h5>Shipping</h5>\n${shp}`;
        }
        withTpl++;
      }

      await db.update(schema.shopifyProducts).set({
        title: t,
        seoTitle: String(o?.seoTitle ?? "").trim().slice(0, 70) || null,
        seoDescription: String(o?.seoDescription ?? "").trim().slice(0, 320) || null,
        tags: String(o?.tags ?? "").trim().slice(0, 600) || r.tags,
        bodyHtml: body.slice(0, 9000) || r.bodyHtml,
        dirty: true, updatedAt: new Date(),
      }).where(eq(schema.shopifyProducts.id, r.id));
      done++;
    } catch (e) { if (errors.length < 3) errors.push(String((e as Error)?.message ?? e).slice(0, 120)); }
  }
  return NextResponse.json({ ok: true, optimized: done, withTemplate: withTpl, total: rows.length, errors: errors.length ? errors : undefined });
}
