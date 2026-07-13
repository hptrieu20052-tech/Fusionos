import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { fileUrl } from "@/lib/storage";

/**
 * Gợi ý design cho order item.
 *
 * Ba tầng, xếp theo độ tin cậy:
 *   1. listing  — listing/product id đã từng gán design nào (chuẩn nhất, 1 listing = 1 design)
 *   2. sku      — SKU (variant id) đã từng gán design nào; hẹp hơn listing nên chỉ là dự phòng
 *   3. name     — trigram similarity giữa tên sản phẩm và tên design (fallback cho listing mới)
 *
 * Đơn CUSTOM (personalize) thì KHÔNG gợi ý: mỗi khách một file riêng, gán nhầm là in sai tên.
 * Một item bị coi là custom khi:
 *   - khách có điền personalization, HOẶC
 *   - listing đó từng gán một design có cờ `personalize` (khoá theo listing, không phụ thuộc
 *     khách có điền hay không — đây mới là chốt chặn thật sự)
 * Với item custom vẫn trả `baseDesign` để designer biết mẫu gốc mà làm, nhưng không có nút Accept.
 */

export type SuggestReason = "listing" | "sku" | "name";

export type Suggest = {
  designId: string;
  skuCode: number;
  title: string;
  thumb: string | null;
  reason: SuggestReason;
  hits?: number;   // số lần design này đã được gán cho listing/sku đó
  score?: number;  // độ giống tên, 0..1 (chỉ với reason = "name")
};

export type SuggestResult = {
  suggests: Suggest[];        // tối đa 3, rỗng nếu là đơn custom
  custom: boolean;            // true → seller phải tự làm design riêng
  baseDesign: Suggest | null; // design gốc của listing custom, chỉ để tham chiếu
};

export type SuggestInput = {
  id: string;
  product_title?: unknown;
  internal_sku?: unknown;
  etsy_listing_id?: unknown;   // Etsy: listing_id · TikTok: product_id (cùng cột)
  personalization?: unknown;
};

type LearnedRow = {
  key: string;
  design_id: string;
  hits: number;
  sku_code: number;
  title: string;
  personalize: boolean;
  thumb_key: string | null;
};

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s ? s : null;
};

const MAX_SUGGESTS = 3;
const NAME_MIN_SCORE = 0.3;

/** Học từ lịch sử: key (listing hoặc sku) → các design đã dùng, xếp theo SỐ LẦN DÙNG giảm dần. */
async function learn(column: "etsy_listing_id" | "internal_sku", keys: string[]) {
  const byKey = new Map<string, LearnedRow[]>();
  if (!keys.length) return byKey;

  const col = column === "etsy_listing_id" ? sql`etsy_listing_id` : sql`internal_sku`;
  const rows = (await db.execute(sql`
    SELECT x.key, x.design_id, x.hits, d.sku_code, d.title, d.personalize, df.thumb_key
    FROM (
      SELECT ${col} AS key, design_id, count(*)::int AS hits
      FROM order_items
      WHERE design_id IS NOT NULL
        AND ${col} IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
      GROUP BY 1, 2
    ) x
    JOIN designs d ON d.id = x.design_id
    LEFT JOIN LATERAL (
      SELECT thumb_key FROM design_files
      WHERE design_id = d.id AND thumb_key IS NOT NULL LIMIT 1
    ) df ON TRUE
    ORDER BY x.key, x.hits DESC, d.sku_code DESC
  `)).rows as LearnedRow[];

  for (const r of rows) (byKey.get(r.key) ?? byKey.set(r.key, []).get(r.key)!).push(r);
  return byKey;
}

/** Fallback: khớp tên sản phẩm với tên design bằng pg_trgm (dùng index idx_designs_title_trgm). */
async function matchByName(titles: string[]) {
  const byTitle = new Map<string, Suggest[]>();
  if (!titles.length) return byTitle;

  const rows = (await db.execute(sql`
    SELECT q.title AS key, d.id, d.sku_code, d.title, d.personalize, df.thumb_key,
           similarity(d.title, q.title) AS sim
    FROM unnest(ARRAY[${sql.join(titles.map((t) => sql`${t}`), sql`, `)}]::text[]) AS q(title)
    JOIN designs d ON d.title % q.title
    LEFT JOIN LATERAL (
      SELECT thumb_key FROM design_files
      WHERE design_id = d.id AND thumb_key IS NOT NULL LIMIT 1
    ) df ON TRUE
    WHERE similarity(d.title, q.title) >= ${NAME_MIN_SCORE}
    ORDER BY q.title, sim DESC
    LIMIT 400
  `)).rows as {
    key: string; id: string; sku_code: number; title: string;
    personalize: boolean; thumb_key: string | null; sim: number;
  }[];

  for (const r of rows) {
    const list = byTitle.get(r.key) ?? byTitle.set(r.key, []).get(r.key)!;
    if (list.length >= MAX_SUGGESTS) continue;
    list.push({
      designId: r.id, skuCode: r.sku_code, title: r.title,
      thumb: fileUrl(r.thumb_key), reason: "name", score: Number(r.sim),
    });
  }
  return byTitle;
}

const toSuggest = (r: LearnedRow, reason: SuggestReason): Suggest => ({
  designId: r.design_id, skuCode: r.sku_code, title: r.title,
  thumb: fileUrl(r.thumb_key), reason, hits: r.hits,
});

export async function suggestForItems(items: SuggestInput[]): Promise<Map<string, SuggestResult>> {
  const out = new Map<string, SuggestResult>();
  if (!items.length) return out;

  const listingIds = Array.from(new Set(items.map((i) => str(i.etsy_listing_id)).filter(Boolean) as string[]));
  const skus = Array.from(new Set(items.map((i) => str(i.internal_sku)).filter(Boolean) as string[]));
  const titles = Array.from(new Set(items.map((i) => str(i.product_title)).filter(Boolean) as string[]));

  const [byListing, bySku, byName] = await Promise.all([
    learn("etsy_listing_id", listingIds).catch(() => new Map<string, LearnedRow[]>()),
    learn("internal_sku", skus).catch(() => new Map<string, LearnedRow[]>()),
    matchByName(titles).catch(() => new Map<string, Suggest[]>()),
  ]);

  for (const it of items) {
    const lid = str(it.etsy_listing_id);
    const sku = str(it.internal_sku);
    const title = str(it.product_title);

    const learnedListing = (lid && byListing.get(lid)) || [];
    const learnedSku = (sku && bySku.get(sku)) || [];

    // ---- Chặn đơn custom ----
    const hasPersoText = !!str(it.personalization);
    // Listing/SKU này từng gán một design personalize → cả listing là loại custom
    const listingIsCustom = [...learnedListing, ...learnedSku].some((r) => r.personalize);
    const custom = hasPersoText || listingIsCustom;

    if (custom) {
      const base = learnedListing[0] ?? learnedSku[0] ?? null;
      out.set(it.id, {
        suggests: [],
        custom: true,
        baseDesign: base ? toSuggest(base, learnedListing[0] ? "listing" : "sku") : null,
      });
      continue;
    }

    // ---- Gộp 3 tầng, khử trùng design, giữ thứ tự ưu tiên ----
    const suggests: Suggest[] = [];
    const seen = new Set<string>();
    const push = (s: Suggest) => {
      if (seen.has(s.designId) || suggests.length >= MAX_SUGGESTS) return;
      seen.add(s.designId);
      suggests.push(s);
    };

    for (const r of learnedListing) push(toSuggest(r, "listing"));
    for (const r of learnedSku) push(toSuggest(r, "sku"));
    for (const s of (title && byName.get(title)) || []) push(s);

    out.set(it.id, { suggests, custom: false, baseDesign: null });
  }

  return out;
}
