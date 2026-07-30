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
 * AI viết lại title (≤70 ký tự), tags, description cho sản phẩm Shopify → lưu local + dirty (Push sau).
 */
type Opt = { title?: string; tags?: string; description?: string };
const SYSTEM = `You optimize a Shopify product for US shoppers ranked on Google Shopping/Search. Rewrite:
- "title": SHORT clean title MAX 70 chars, strongest buyer keyword first, Title Case, no emojis/shop name.
- "tags": 12-15 comma-separated lowercase tags a US shopper searches (occasion, recipient, product type, style). No underscores/#.
- "description": concise 2-3 sentence HTML-safe plain description focused on the gift/occasion. No emojis.
Return STRICT JSON: {"title":"...","tags":"a, b, c","description":"..."}`;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 20);
  if (!ids.length) return NextResponse.json({ ok: false, error: "Select up to 20 products" }, { status: 400 });
  const model = typeof b?.model === "string" && b.model.trim() ? b.model.trim() : undefined;

  const rows = await db.select({ id: schema.shopifyProducts.id, title: schema.shopifyProducts.title, tags: schema.shopifyProducts.tags, bodyHtml: schema.shopifyProducts.bodyHtml, seller: schema.stores.sellerId })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  let done = 0; const errors: string[] = [];
  for (const r of rows) {
    try {
      const user = `Title: ${r.title}\nTags: ${r.tags ?? ""}\nDescription (first 500 chars): ${(r.bodyHtml ?? "").replace(/<[^>]+>/g, " ").slice(0, 500)}`;
      const o = await orChatJSON<Opt>(SYSTEM, user, { model, maxTokens: 500, temperature: 0.6, timeoutMs: 45000 });
      const t = String(o?.title ?? "").trim().slice(0, 70);
      if (!t) throw new Error("empty title");
      await db.update(schema.shopifyProducts).set({
        title: t,
        tags: String(o?.tags ?? "").trim().slice(0, 600) || r.tags,
        bodyHtml: String(o?.description ?? "").trim().slice(0, 2000) || r.bodyHtml,
        dirty: true, updatedAt: new Date(),
      }).where(eq(schema.shopifyProducts.id, r.id));
      done++;
    } catch (e) { if (errors.length < 3) errors.push(String((e as Error)?.message ?? e).slice(0, 120)); }
  }
  return NextResponse.json({ ok: true, optimized: done, total: rows.length, errors: errors.length ? errors : undefined });
}
