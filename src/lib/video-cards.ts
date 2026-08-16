import { db, schema } from "@/lib/db";
import { and, eq, isNull, sql } from "drizzle-orm";

/**
 * v272 · Card cha — video con (Video Library).
 *
 * Mã card = <viết tắt Seller>-<viết tắt Creator>-<NN>, vd "QT-TH-01":
 *   · viết tắt = chữ cái đầu mỗi từ trong full_name, VIẾT HOA, BỎ DẤU (Trường→T, Hiền→H, Đĩnh→D)
 *   · NN đếm riêng theo cặp (sellerId, creatorId) THẬT trong DB — 2 người trùng viết tắt không lẫn nhau
 *   · nếu mã trùng (cặp khác nhưng viết tắt giống hệt) thì tăng NN tới khi trống — mã là UNIQUE.
 * Video con đánh số cardSeq 1,2,3… — hiển thị "QT-TH-01.2". Xoá video con KHÔNG dồn số lại
 * (giữ nhãn ổn định); card rỗng thì xoá luôn card.
 *
 * BẤT BIẾN quan trọng: productId/storeId của card luôn đồng bộ xuống MỌI video con — nhờ vậy
 * caption AI, UTM link, push Shopify (đều đọc productId trên từng video) chạy y như cũ.
 */

/** "Quang Trường" → "QT" · bỏ dấu tiếng Việt (Đ→D) · tên trống → "XX". */
export function initialsOf(name: string | null | undefined): string {
  const clean = String(name ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // bỏ dấu tổ hợp (á→a, ệ→e…)
    .replace(/đ/g, "d").replace(/Đ/g, "D");
  const parts = clean.trim().split(/\s+/).filter(Boolean);
  const ini = parts.map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  return ini || "XX";
}

async function nameOf(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [u] = await db.select({ n: schema.users.fullName }).from(schema.users)
    .where(eq(schema.users.id, userId)).limit(1);
  return u?.n ?? null;
}

const pairCond = (sellerId: string | null, creatorId: string | null) => and(
  sellerId ? eq(schema.videoCards.sellerId, sellerId) : isNull(schema.videoCards.sellerId),
  creatorId ? eq(schema.videoCards.creatorId, creatorId) : isNull(schema.videoCards.creatorId),
);

/** Tạo card mới cho cặp seller/creator — tự sinh mã QT-TH-NN, chống trùng mã. */
export async function createCard(opts: {
  sellerId: string | null; creatorId: string | null;
  storeId?: string | null; productId?: string | null;
}): Promise<{ id: string; code: string }> {
  const si = initialsOf(await nameOf(opts.sellerId));
  const ci = opts.creatorId ? initialsOf(await nameOf(opts.creatorId)) : "";
  const [m] = await db.select({ n: sql<number>`coalesce(max(${schema.videoCards.seq}),0)::int` })
    .from(schema.videoCards).where(pairCond(opts.sellerId, opts.creatorId));
  let seq = (m?.n ?? 0) + 1;
  // Cặp KHÁC nhưng viết tắt trùng hệt (Quang Trường vs Quốc Trung đều QT) → mã đụng nhau.
  // Tăng NN tới khi mã trống; NN vẫn thuộc về cặp này nên không phá đếm của cặp khác.
  for (let guard = 0; guard < 500; guard++) {
    const code = ci ? `${si}-${ci}-${String(seq).padStart(2, "0")}` : `${si}-${String(seq).padStart(2, "0")}`;
    const [dup] = await db.select({ id: schema.videoCards.id }).from(schema.videoCards)
      .where(eq(schema.videoCards.code, code)).limit(1);
    if (!dup) {
      const [row] = await db.insert(schema.videoCards).values({
        code, seq,
        sellerId: opts.sellerId, creatorId: opts.creatorId,
        storeId: opts.storeId ?? null, productId: opts.productId ?? null,
      }).returning({ id: schema.videoCards.id, code: schema.videoCards.code });
      return row;
    }
    seq++;
  }
  throw new Error("could not allocate a card code");
}

/** Thêm 1 video vào card: cấp cardSeq kế tiếp + đồng bộ productId/storeId của card xuống video. */
export async function addVideoToCard(videoId: string, cardId: string): Promise<number> {
  const [card] = await db.select().from(schema.videoCards).where(eq(schema.videoCards.id, cardId)).limit(1);
  if (!card) throw new Error("card not found");
  const [m] = await db.select({ n: sql<number>`coalesce(max(${schema.productVideos.cardSeq}),0)::int` })
    .from(schema.productVideos).where(eq(schema.productVideos.cardId, cardId));
  const nextSeq = (m?.n ?? 0) + 1;
  await db.update(schema.productVideos).set({
    cardId, cardSeq: nextSeq,
    // Card đã gắn listing thì video mới vào card nhận luôn listing đó (bất biến đồng bộ).
    ...(card.productId ? { productId: card.productId, storeId: card.storeId } : {}),
    updatedAt: new Date(),
  }).where(eq(schema.productVideos.id, videoId));
  return nextSeq;
}

/** Gỡ video khỏi card; card rỗng thì xoá card luôn. Trả về true nếu card đã bị xoá. */
export async function detachVideoFromCard(videoId: string): Promise<boolean> {
  const [v] = await db.select({ cardId: schema.productVideos.cardId })
    .from(schema.productVideos).where(eq(schema.productVideos.id, videoId)).limit(1);
  const cardId = v?.cardId;
  await db.update(schema.productVideos).set({ cardId: null, cardSeq: null, updatedAt: new Date() })
    .where(eq(schema.productVideos.id, videoId));
  if (!cardId) return false;
  const [left] = await db.select({ n: sql<number>`count(*)::int` })
    .from(schema.productVideos).where(eq(schema.productVideos.cardId, cardId));
  if ((left?.n ?? 0) === 0) {
    await db.delete(schema.videoCards).where(eq(schema.videoCards.id, cardId));
    return true;
  }
  return false;
}

/** Card rỗng (sau khi xoá video) thì dọn luôn — gọi sau DELETE video. */
export async function cleanupCardIfEmpty(cardId: string | null): Promise<void> {
  if (!cardId) return;
  const [left] = await db.select({ n: sql<number>`count(*)::int` })
    .from(schema.productVideos).where(eq(schema.productVideos.cardId, cardId));
  if ((left?.n ?? 0) === 0) await db.delete(schema.videoCards).where(eq(schema.videoCards.id, cardId));
}
