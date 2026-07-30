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
 * POST /api/etsy-products/ai-optimize { ids: string[] }
 * Dùng AI (OpenRouter) viết lại cho từng listing: title NGẮN chuẩn SEO Google Shopping/Shopify
 * (≤ 70 ký tự, từ khoá mạnh ở đầu), bộ tag sạch, và mô tả gọn. Lưu vào shopify_title/tags/desc —
 * KHÔNG đụng title gốc Etsy. Export Shopify sẽ ưu tiên bản đã tối ưu.
 * Xử lý tối đa 20 listing/lần để không vượt maxDuration.
 */
type Opt = { title?: string; tags?: string; description?: string };

const SYSTEM = `You optimize e-commerce product listings for a Shopify store selling personalized print-on-demand gifts to US shoppers, ranked on Google Shopping and Google Search.
For the given Etsy listing, rewrite:
- "title": a SHORT, clean product title, MAX 70 characters. Put the strongest buyer keyword first (e.g. "Personalized Dog Story Book"). Natural, not keyword-stuffed. Title Case. No emojis, no "Etsy", no shop name.
- "tags": 12-15 comma-separated tags a US shopper would search (gift occasion, recipient, product type, style). Lowercase, no underscores, no # symbol.
- "description": a concise 2-3 sentence product description for Google, plain text, focused on the gift/occasion/who it's for. No emojis.
Return STRICT JSON: {"title": "...", "tags": "a, b, c", "description": "..."}`;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 20);
  if (!ids.length) return NextResponse.json({ ok: false, error: "Select up to 20 listings" }, { status: 400 });
  // Model do người dùng chọn (slug OpenRouter); rỗng → dùng model text mặc định (OPENROUTER_TEXT_MODEL).
  const model = typeof b?.model === "string" && b.model.trim() ? b.model.trim() : undefined;

  const rows = await db.select({
    id: schema.etsyProducts.id, storeId: schema.etsyProducts.storeId,
    title: schema.etsyProducts.title, tags: schema.etsyProducts.tags, description: schema.etsyProducts.description,
  }).from(schema.etsyProducts).where(inArray(schema.etsyProducts.id, ids));

  // Scope: seller chỉ tối ưu listing store mình
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds) {
    const allowed = new Set((await db.select({ id: schema.stores.id }).from(schema.stores).where(inArray(schema.stores.sellerId, scopeIds))).map((s) => s.id));
    if (rows.some((r) => !allowed.has(r.storeId))) return NextResponse.json({ ok: false, error: "forbidden: listing not in your store" }, { status: 403 });
  }

  let done = 0; const errors: string[] = [];
  for (const r of rows) {
    try {
      const user = `Etsy title: ${r.title}\nEtsy tags: ${(r.tags ?? "").replace(/_/g, " ")}\nEtsy description (first 500 chars): ${(r.description ?? "").slice(0, 500)}`;
      const o = await orChatJSON<Opt>(SYSTEM, user, { model, maxTokens: 500, temperature: 0.6, timeoutMs: 45000 });
      const t = String(o?.title ?? "").trim().slice(0, 70);
      if (!t) throw new Error("empty title");
      await db.update(schema.etsyProducts).set({
        shopifyTitle: t,
        shopifyTags: String(o?.tags ?? "").trim().slice(0, 600) || null,
        shopifyDesc: String(o?.description ?? "").trim().slice(0, 2000) || null,
        updatedAt: new Date(),
      }).where(eq(schema.etsyProducts.id, r.id));
      done++;
    } catch (e) { if (errors.length < 3) errors.push(String((e as Error)?.message ?? e).slice(0, 120)); }
  }
  return NextResponse.json({ ok: true, optimized: done, total: rows.length, errors: errors.length ? errors : undefined });
}
