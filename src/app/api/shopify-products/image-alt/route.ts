import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopHost, shopifyGraphQL, type ShopifyCred } from "@/lib/shopify";
import { orChatJSON } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
// Vercel PRO ⇒ 300s. Hạ về Hobby thì phải đưa maxDuration = 60 và BUDGET_MS = 52_000.
export const maxDuration = 300;
const BUDGET_MS = 270_000;

/**
 * POST /api/shopify-products/image-alt { ids, model?, limitPerProduct? }
 *
 * Sinh alt text cho ẢNH ĐANG TRỐNG alt rồi ghi THẲNG lên Shopify (productUpdateMedia,
 * chỉ field alt). Không đụng title/description/giá/status ⇒ không cần bấm Push.
 *
 * Alt được sinh bằng model VISION: đưa chính tấm ảnh cho model xem, kèm tiêu đề + loại
 * sản phẩm làm ngữ cảnh. Không đoán theo vị trí ảnh — ảnh số 3 của listing này là ảnh
 * trải trang, của listing kia là bảng size, đoán theo vị trí là sai.
 *
 * LUẬT CỨNG — ảnh nào ĐÃ CÓ alt thì BỎ QUA, không ghi đè (có thể là alt người tự viết).
 *
 * Vì sao alt đáng làm: Google Images là nguồn traffic miễn phí thật với hàng quà tặng
 * cá nhân hoá, và alt cũng là tín hiệu phụ cho chính trang sản phẩm trên Google Search.
 * Alt KHÔNG phải attribute của feed Merchant Center ⇒ ghi alt không kích hoạt duyệt lại.
 */
const MAX_PER_CALL = 6;      // 6 listing/request — mỗi listing 1 lượt gọi vision, bắn nhiều dễ 429
const MAX_IMG = 10;          // trần ảnh mỗi listing cho 1 lượt gọi
const ALT_MAX = 125;         // chuẩn a11y/SEO: screen reader cắt quanh 125 ký tự

const M_UPDATE = `mutation fusionImageAlt($productId: ID!, $media: [UpdateMediaInput!]!) {
  productUpdateMedia(productId: $productId, media: $media) {
    media { ... on MediaImage { id } }
    mediaUserErrors { field message }
  }
}`;

type Img = { id?: string; src?: string; altText?: string; position?: number; [k: string]: unknown };

const SYSTEM = `You write image alt text for a Shopify product page, for accessibility and Google Images.

You are shown the product's images in order. For EACH image, describe what is ACTUALLY VISIBLE in that image — the object, its material and finish, what is printed or shown on it, who or what appears in the scene, the setting. If an image is a size chart, a spec graphic, a text banner or a step-by-step instruction, say so and state what it shows.

Rules for every alt string:
- 70-125 characters. Never exceed 125.
- Plain descriptive sentence fragment. No trailing period needed.
- Weave the product's primary keyword in ONCE, naturally, only where it fits what is really in the picture. Never repeat the keyword across every image.
- Never start with "Image of", "Photo of", "Picture of".
- No shop name, no marketing slogans, no prices, no emojis, no quotes, no keyword lists.
- Every alt must be DIFFERENT from the others — they describe different pictures.

Return STRICT JSON: {"alts": ["...", "..."]} — exactly one string per image, in the same order as the images given.`;

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Ảnh Shopify CDN: xin bản 600px cho model xem — nhanh hơn và rẻ hơn ảnh gốc 2000px,
// vẫn đủ nét để nhận ra nội dung. URL đã có query (?v=...) nên nối bằng &.
const thumb = (src: string) => (src.includes("?") ? `${src}&width=600` : `${src}?width=600`);

export async function POST(req: NextRequest) {
  const deadline = Date.now() + BUDGET_MS;
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, MAX_PER_CALL);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  const model = typeof b?.model === "string" && b.model.trim() ? b.model.trim() : (process.env.OPENROUTER_VISION_MODEL || "openai/gpt-4o-mini");
  const cap = Math.min(Math.max(Number(b?.limitPerProduct) || MAX_IMG, 1), MAX_IMG);

  const rows = await db.select({
    id: schema.shopifyProducts.id, gid: schema.shopifyProducts.shopifyProductId, title: schema.shopifyProducts.title,
    productType: schema.shopifyProducts.productType, seoTitle: schema.shopifyProducts.seoTitle, tags: schema.shopifyProducts.tags,
    images: schema.shopifyProducts.images, storeId: schema.shopifyProducts.storeId,
    cred: schema.stores.apiCredentials, seller: schema.stores.sellerId, mk: schema.stores.marketplace,
  }).from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  if (!rows.length) return NextResponse.json({ ok: false, error: "không tìm thấy sản phẩm" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  type Res = { id: string; title: string; ok: boolean; written?: number; skipped?: number; error?: string };

  // Song song từng listing — 1 con hỏng không kéo cả lô.
  const results = await Promise.all(rows.map(async (r, idx): Promise<Res> => {
    try {
      const cred = (r.cred ?? {}) as ShopifyCred;
      if (r.mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret)))
        return { id: r.id, title: r.title, ok: false, error: "store chưa cấu hình Shopify API" };
      if (!r.gid) return { id: r.id, title: r.title, ok: false, error: "listing chưa có Shopify product ID — Sync lại" };

      const all = (Array.isArray(r.images) ? r.images as Img[] : []);
      // Chỉ ảnh có media GID thật + đang trống alt. Ảnh mới upload chưa Push thì chưa có GID → bỏ qua.
      const blanks = all.filter((m) => String(m?.id ?? "").startsWith("gid://") && String(m?.src ?? "").startsWith("http") && !clip(m?.altText, 500));
      const already = all.length - blanks.length;
      if (!blanks.length) return { id: r.id, title: r.title, ok: true, written: 0, skipped: already };

      const batch = blanks.slice(0, cap);
      await sleep(idx * 500); // lệch pha để tránh 429
      if (deadline - Date.now() < 20000) return { id: r.id, title: r.title, ok: false, error: "hết thời gian trong 1 request — bấm Retry failed" };

      const user = `Product title: ${clip(r.title, 200)}
Product type: ${clip(r.productType, 80) || "personalized photo book"}
SEO title: ${clip(r.seoTitle, 120) || "(none)"}
Search terms buyers use: ${clip(r.tags, 300) || "(none)"}
Number of images: ${batch.length}

Return exactly ${batch.length} alt strings, one per image, in order.`;

      const out = await orChatJSON<{ alts?: unknown }>(SYSTEM, user, {
        model,
        images: batch.map((m) => thumb(String(m.src))),
        maxTokens: 1200,
        temperature: 0.4,
        timeoutMs: Math.min(90_000, Math.max(15_000, deadline - Date.now() - 8000)),
      });
      const alts = Array.isArray(out?.alts) ? (out.alts as unknown[]).map((x) => clip(x, ALT_MAX)) : [];
      if (!alts.length) throw new Error("model không trả alt nào");

      // Chỉ ghi những ảnh thực sự có alt trả về; model trả thiếu thì phần còn lại để nguyên (lần sau chạy lại).
      const plan = batch.map((m, i) => ({ id: String(m.id), alt: alts[i] ?? "" })).filter((p) => p.alt.length >= 5);
      if (!plan.length) throw new Error("alt trả về rỗng/quá ngắn");

      const d = await shopifyGraphQL<{ productUpdateMedia?: { mediaUserErrors?: { message?: string }[] } }>(cred, M_UPDATE, {
        productId: r.gid,
        media: plan.map((p) => ({ id: p.id, alt: p.alt })),
      });
      const errs = d.productUpdateMedia?.mediaUserErrors ?? [];
      if (errs.length) return { id: r.id, title: r.title, ok: false, error: errs.map((e) => e.message).filter(Boolean).join("; ").slice(0, 200) };

      // Ghi lại bản local để lần Push sau không đẩy alt rỗng đè lên Shopify.
      const byId = new Map(plan.map((p) => [p.id, p.alt]));
      const merged = all.map((m) => byId.has(String(m?.id)) ? { ...m, altText: byId.get(String(m.id))! } : m);
      await db.update(schema.shopifyProducts).set({ images: merged, updatedAt: new Date() }).where(eq(schema.shopifyProducts.id, r.id));

      return { id: r.id, title: r.title, ok: true, written: plan.length, skipped: already };
    } catch (e) {
      return { id: r.id, title: r.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 240) };
    }
  }));

  const done = results.filter((x) => x.ok).length;
  return NextResponse.json({
    ok: done > 0, pushed: done, failed: results.length - done,
    written: results.reduce((s, x) => s + (x.written ?? 0), 0),
    skipped: results.reduce((s, x) => s + (x.skipped ?? 0), 0),
    results,
  });
}
