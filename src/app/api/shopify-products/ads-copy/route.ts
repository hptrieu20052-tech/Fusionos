import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds, sharedStoreIds } from "@/lib/scope";
import { orChatJSON } from "@/lib/ai/openrouter";
import { getPrompt } from "@/lib/ai/prompt-store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const BUDGET_MS = 100_000;

/**
 * v455 · POST /api/shopify-products/ads-copy { ids, model? }
 * AI viết primary text + headline cho Meta Ads Kit — nhìn ẢNH ĐẦU của listing + facts template.
 * KHÔNG ghi DB — client giữ bản sinh ra (kitTexts + localStorage adskit.texts), sửa tay được tiếp.
 */
const MAX_PER_CALL = 8;
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function firstImg(v: unknown): string[] {
  const arr = (Array.isArray(v) ? v : []) as { src?: string; position?: number }[];
  const s = arr.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99))
    .map((i) => String(i?.src ?? "").trim()).find((x) => /^https:\/\//i.test(x));
  return s ? [s + (s.includes("?") ? "&" : "?") + "width=900"] : [];
}

export async function POST(req: NextRequest) {
  const SYSTEM = await getPrompt("shopify.adsCopy"); // admin ghi đè qua Manager Prompts
  const deadline = Date.now() + BUDGET_MS;
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, MAX_PER_CALL);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  const model = typeof b?.model === "string" && b.model.trim() ? b.model.trim() : undefined;

  const rows = await db.select({
    id: schema.shopifyProducts.id, storeId: schema.shopifyProducts.storeId, title: schema.shopifyProducts.title,
    tags: schema.shopifyProducts.tags, productType: schema.shopifyProducts.productType,
    images: schema.shopifyProducts.images, templateId: schema.shopifyProducts.templateId,
    seller: schema.stores.sellerId, sStoreId: schema.stores.id,
  }).from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  if (!rows.length) return NextResponse.json({ ok: false, error: "không tìm thấy sản phẩm" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  const shared = await sharedStoreIds(scopeIds);
  if (scopeIds && rows.some((r) => !((r.seller && scopeIds.includes(r.seller)) || (r.sStoreId && shared.includes(r.sStoreId))))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // Facts từ template (Product Details) — nguồn sự thật cho dòng trust (ship/guarantee).
  const tpls = await db.select().from(schema.shopifyTemplates);
  const tplFor = (storeId: string, productType: string | null, pinnedId: string | null) => {
    if (pinnedId) { const p = tpls.find((t) => t.id === pinnedId); if (p) return p; }
    const list = tpls.filter((t) => t.storeId === storeId);
    const pt = (productType ?? "").trim().toLowerCase();
    if (pt) { const byType = list.find((t) => (t.productType ?? "").trim().toLowerCase() === pt); if (byType) return byType; }
    return list.length === 1 ? list[0] : null;
  };

  const results = await Promise.all(rows.map(async (r, idx): Promise<{ id: string; ok: boolean; primary?: string; headline?: string; error?: string }> => {
    try {
      await sleep(idx * 350);
      if (deadline - Date.now() < 15000) throw new Error("hết thời gian — thử lại");
      const tpl = tplFor(r.storeId, r.productType, r.templateId);
      const user = `Product title: ${clip(r.title, 200)}
Product type: ${clip(r.productType, 80)}
Search terms buyers use: ${clip(r.tags, 300)}
FACTS (ground truth for the trust line — only claim what is here):
[Product info] ${clip(tpl?.baseDescription, 900) || "(none)"}
[Specs] ${clip(tpl?.productDetails, 900) || "(none)"}
[Shipping] ${clip(tpl?.shippingInfo, 500) || "(none)"}`;
      const o = await orChatJSON<{ primary?: string; headline?: string }>(SYSTEM, user, {
        model, maxTokens: 4000, temperature: 0.7, reasoning: "low", images: firstImg(r.images),
        timeoutMs: Math.min(60_000, Math.max(15_000, deadline - Date.now() - 5000)),
      });
      const primary = String(o?.primary ?? "").trim().slice(0, 600);
      const headline = clip(o?.headline, 60);
      if (!primary || !headline) throw new Error("model trả thiếu primary/headline");
      return { id: r.id, ok: true, primary, headline };
    } catch (e) {
      return { id: r.id, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) };
    }
  }));

  return NextResponse.json({ ok: results.some((x) => x.ok), done: results.filter((x) => x.ok).length, results });
}
