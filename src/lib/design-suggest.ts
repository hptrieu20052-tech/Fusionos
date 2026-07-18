import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { fileUrl } from "@/lib/storage";
import { isCustomItem } from "@/lib/variant-display";

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
  variant?: unknown;
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

const toSuggest = (r: LearnedRow, reason: SuggestReason): Suggest => ({
  designId: r.design_id, skuCode: r.sku_code, title: r.title,
  thumb: fileUrl(r.thumb_key), reason, hits: r.hits,
});

export async function suggestForItems(items: SuggestInput[]): Promise<Map<string, SuggestResult>> {
  const out = new Map<string, SuggestResult>();
  if (!items.length) return out;

  const listingIds = Array.from(new Set(items.map((i) => str(i.etsy_listing_id)).filter(Boolean) as string[]));
  const skus = Array.from(new Set(items.map((i) => str(i.internal_sku)).filter(Boolean) as string[]));
  const [byListing, bySku] = await Promise.all([
    learn("etsy_listing_id", listingIds).catch(() => new Map<string, LearnedRow[]>()),
    learn("internal_sku", skus).catch(() => new Map<string, LearnedRow[]>()),
  ]);

  for (const it of items) {
    const lid = str(it.etsy_listing_id);
    const sku = str(it.internal_sku);

    const learnedListing = (lid && byListing.get(lid)) || [];
    const learnedSku = (sku && bySku.get(sku)) || [];

    // ---- Chặn đơn custom ----
    // Etsy "Custom options" (Text box / List / File upload) do seller TỰ ĐẶT TÊN
    // ("Please enter the name here"…) nên lẫn vào variant, cột personalization bị bỏ trống.
    // Không thể chỉ trông vào personalization — phải soi cả tiêu đề và tên field trong variant.
    const looksCustom = isCustomItem(
      it.product_title as string | null,
      it.variant as string | null,
      it.personalization as string | null,
    );
    // Listing/SKU này từng gán một design personalize → cả listing là loại custom
    const listingIsCustom = [...learnedListing, ...learnedSku].some((r) => r.personalize);
    const custom = looksCustom || listingIsCustom;

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

    // CHỈ gợi ý khi khớp LISTING (100% chuẩn: listing này từng gán đúng design này).
    // BỎ khớp theo SKU (hẹp) và khớp TÊN (fuzzy % < 100%) — yêu cầu: chỉ suggest bản đúng 100%.
    for (const r of learnedListing) push(toSuggest(r, "listing"));

    out.set(it.id, { suggests, custom: false, baseDesign: null });
  }

  return out;
}
