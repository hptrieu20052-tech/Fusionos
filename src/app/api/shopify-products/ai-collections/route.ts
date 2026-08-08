import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopHost, type ShopifyCred } from "@/lib/shopify";
import { listCustomCollections, collectionAddProducts, addTags } from "@/lib/shopify-bulk";
import { orChatJSON } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/shopify-products/ai-collections { ids, model? }
 *
 * AI nhìn ảnh + đọc title/mô tả rồi CHỌN 1–2 collection ĐANG CÓ trên store cho từng sản phẩm.
 * KHÔNG tạo collection mới — chỉ chọn trong danh sách sẵn có (quyết định cấu trúc shop là việc
 * của người). Con nào không hợp cái nào → trả rỗng, đánh dấu "unmatched" để người tự xử.
 *
 * Sản phẩm ĐÃ trên Shopify (có gid): thêm vào collection ngay (collectionAddProducts, cộng dồn).
 * Bản NHÁP (gid rỗng): chỉ ghi vào shopify_products.collections; lúc Push sẽ tự áp (v172b).
 *
 * Luật ưu tiên: Dịp/Cột mốc > Faith/Family > Birthday/Holiday > Bedtime/Baby > Adventure.
 */
const MAX_PER_CALL = 8;
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

const SYSTEM = `You sort a personalized children's book into the RIGHT store collection(s). You are given the FIXED list of collections that already exist in this store. You may ONLY pick from that list — never invent a new collection name.

LOOK AT THE PRODUCT PHOTOS and read the title. Decide the collection by the book's strongest theme, using this priority when several could fit (higher wins):
1. Learning & milestone — first day of school, kindergarten/preschool, graduation, alphabet/ABC, counting, learning to read, milestone.
2. Faith & family — baptism, christening, Bible, prayer, faith, blessing, dad/mom, Father's/Mother's Day, family, grandparent.
3. Birthday & celebration — birthday, 1st/first birthday, Halloween, Christmas, holiday, celebration.
4. Baby & bedtime — bedtime, baby, newborn, nursery, baby shower, sleep, lullaby, nursery rhyme.
5. Adventure & imagination — farm, ocean, space, dinosaur, cowboy, jungle/safari, pirate, animal adventure, imaginative worlds (only when no stronger occasion applies).

Match a book to the collection whose THEME fits, by meaning — the store's collection titles may be worded differently from these five buckets, so map by concept, not by exact words. Pick ONE collection normally; pick a SECOND only if the book genuinely belongs to both (e.g. a birthday book that is also a bedtime book). Never pick more than two. If NONE of the existing collections fit the book, return an empty array — do not force a bad match.

ALSO decide HOLIDAY/OCCASION tags (v199b) — from this FIXED list only:
christmas, easter, mothers day, fathers day, back to school, valentines day, halloween, thanksgiving, grandparents day, st patricks day, 4th of july, new year, hanukkah
Pick 0-2 that the product CLEARLY matches by its artwork or title: Santa/tree/stocking/sleigh → christmas; bunny/eggs/spring pastel basket → easter; dad/daddy/father → fathers day; mom/mommy/mother → mothers day; school/classroom/ABC/backpack/routine chart → back to school; hearts/love/valentine → valentines day; pumpkin/ghost/witch → halloween; turkey/autumn harvest/thankful/gratitude → thanksgiving; grandma/grandpa/nana/papa/grandparent → grandparents day; shamrock/leprechaun/lucky → st patricks day; American flag/stars and stripes/fireworks → 4th of july; countdown/new year → new year; menorah/dreidel → hanukkah. A generic product with no clear holiday theme gets NO occasion tags — be conservative; these tags drive the store's holiday collections and a wrong tag puts the product on the wrong shelf.

Return STRICT JSON: {"collections": ["<exact title from the provided list>", ...], "occasions": ["<from the fixed list>", ...]} — collections: 0-2 titles copied EXACTLY from the provided list; occasions: 0-2 from the fixed list.`;

// v199b · danh sách tag dịp lễ hợp lệ — chỉ nhận đúng các slug này từ AI.
// Thêm lễ mới: thêm slug vào đây + vào danh sách trong SYSTEM prompt, và tạo collection automated
// theo tag đó bên Shopify. 3 chỗ phải khớp chuỗi tuyệt đối.
const OCCASIONS = [
  "christmas", "easter", "mothers day", "fathers day", "back to school", "valentines day", "halloween",
  "thanksgiving", "grandparents day", "st patricks day", "4th of july", "new year", "hanukkah",
];

export async function POST(req: NextRequest) {
  const deadline = Date.now() + 290_000;
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, MAX_PER_CALL);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  const model = typeof b?.model === "string" && b.model.trim() ? b.model.trim() : undefined;

  const rows = await db.select({
    id: schema.shopifyProducts.id, storeId: schema.shopifyProducts.storeId, title: schema.shopifyProducts.title,
    bodyHtml: schema.shopifyProducts.bodyHtml, images: schema.shopifyProducts.images, gid: schema.shopifyProducts.shopifyProductId,
    tags: schema.shopifyProducts.tags,
    cred: schema.stores.apiCredentials, seller: schema.stores.sellerId, mk: schema.stores.marketplace,
  }).from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // Danh sách collection sẵn có, theo store (1 request/store, cache trong lô).
  const collCache = new Map<string, { id: string; title: string }[]>();
  async function collsFor(storeId: string, cred: ShopifyCred): Promise<{ id: string; title: string }[]> {
    if (collCache.has(storeId)) return collCache.get(storeId)!;
    let list: { id: string; title: string }[] = [];
    try { list = await listCustomCollections(cred); } catch { list = []; }
    collCache.set(storeId, list);
    return list;
  }

  const results: { id: string; title: string; ok: boolean; collections?: string[]; occasions?: string[]; unmatched?: boolean; error?: string }[] =
    await Promise.all(rows.map(async (r, idx): Promise<{ id: string; title: string; ok: boolean; collections?: string[]; occasions?: string[]; unmatched?: boolean; error?: string }> => {
      const cred = (r.cred ?? {}) as ShopifyCred;
      if (r.mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
        return { id: r.id, title: r.title, ok: false, error: "store chưa cấu hình Shopify API" };
      }
      try {
        await sleep(idx * 350); // lệch pha tránh 429
        const colls = await collsFor(r.storeId, cred);
        if (!colls.length) return { id: r.id, title: r.title, ok: false, error: "store chưa có manual collection nào — tạo collection trước" };
        const list = colls.map((c) => `- ${c.title}`).join("\n");
        const desc = clip((r.bodyHtml ?? "").replace(/<[^>]+>/g, " "), 700);
        const user = `AVAILABLE COLLECTIONS (pick only from these exact titles):\n${list}\n\nPRODUCT\nTitle: ${clip(r.title, 250)}\nDescription: ${desc || "(none)"}`;

        const o = await orChatJSON<{ collections?: unknown; occasions?: unknown }>(SYSTEM, user, {
          model, maxTokens: 1500, temperature: 0.2, reasoning: "low", images: imgUrls(r.images),
          timeoutMs: Math.min(45000, deadline - Date.now() - 2000),
        });
        // Khớp tên AI trả về với collection thật (không phân biệt hoa thường / khoảng trắng thừa).
        const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
        const byNorm = new Map(colls.map((c) => [norm(c.title), c]));
        const picked = (Array.isArray(o?.collections) ? o!.collections! : [])
          .map((x) => byNorm.get(norm(String(x))))
          .filter((c): c is { id: string; title: string } => !!c)
          .slice(0, 2);
        // Khử trùng theo id
        const uniq = Array.from(new Map(picked.map((c) => [c.id, c])).values());

        // v199 · TAG DỊP LỄ: chỉ nhận slug trong danh sách cố định, cộng vào tags (không xoá tag cũ).
        // Collection lễ chạy automated theo tag sẽ tự hút sản phẩm — Shopify không cho gán thẳng
        // vào automated collection nên đây là đường duy nhất đúng.
        const occ = (Array.isArray(o?.occasions) ? o!.occasions! : [])
          .map((x) => norm(String(x)))
          .filter((x) => OCCASIONS.includes(x))
          .slice(0, 2);
        let newTags: string[] = [];
        if (occ.length) {
          const cur = String(r.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
          const curNorm = new Set(cur.map(norm));
          newTags = occ.filter((x) => !curNorm.has(x));
          if (newTags.length) {
            await db.update(schema.shopifyProducts)
              .set({ tags: [...cur, ...newTags].join(", "), updatedAt: new Date() })
              .where(eq(schema.shopifyProducts.id, r.id));
            if (r.gid) { try { await addTags(cred, r.gid, newTags); } catch { /* tag lỗi không chặn kết quả */ } }
          }
        }

        if (!uniq.length) return { id: r.id, title: r.title, ok: true, unmatched: true, collections: [], occasions: newTags };

        // Ghi local (cả bản nháp lẫn sản phẩm thật) — nguồn sự thật cho bảng + cho Push bản nháp.
        await db.update(schema.shopifyProducts)
          .set({ collections: uniq.map((c) => ({ id: c.id, title: c.title })), updatedAt: new Date() })
          .where(eq(schema.shopifyProducts.id, r.id));

        // Sản phẩm đã trên Shopify → gắn vào collection ngay (cộng dồn, không gỡ khỏi collection khác).
        if (r.gid) {
          for (const c of uniq) {
            try { await collectionAddProducts(cred, c.id, [r.gid]); } catch { /* lỗi 1 collection không chặn cả sản phẩm */ }
          }
        }
        return { id: r.id, title: r.title, ok: true, collections: uniq.map((c) => c.title), occasions: newTags };
      } catch (e) {
        return { id: r.id, title: r.title, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) };
      }
    }));

  const assigned = results.filter((r) => r.ok && !r.unmatched).length;
  const unmatched = results.filter((r) => r.ok && r.unmatched).length;
  const failed = results.filter((r) => !r.ok).length;
  const tagged = results.filter((r) => r.ok && (r.occasions ?? []).length > 0).length;
  return NextResponse.json({ ok: assigned + unmatched > 0, assigned, unmatched, failed, tagged, results });
}
