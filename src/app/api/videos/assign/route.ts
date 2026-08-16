import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { createCard } from "@/lib/video-cards";

export const dynamic = "force-dynamic";

/**
 * v209 · POST /api/videos/assign — gán video vào listing. MỖI LISTING ĐÚNG 1 VIDEO.
 *
 *   { videoId, productType: "Custom Shape Wooden Puzzle" }  → gán cho MỌI listing thuộc type đó
 *   { videoId, productIds: [...] }                          → gán cho đúng các listing này
 *   { videoId: null, productIds: [...] }                    → gỡ video khỏi các listing này
 *
 * Gán theo Product type là đường chính: 180 listing puzzle dùng chung 1 clip "ghép tên" ⇒ một thao
 * tác thay cho 180 lần dán tay. Cùng quy ước với v190 (shipping profile khớp theo Product type).
 *
 * Đổi video của listing ĐÃ đẩy media lên Shopify thì xoá luôn dấu vết media cũ (video_media_id)
 * để lần Push sau đẩy bản mới — nếu không sẽ tưởng đã đẩy rồi và bỏ qua.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "videos")) < 2) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const b = await req.json().catch(() => null);
  const uuidOk = (x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x));
  const videoId: string | null = uuidOk(b?.videoId) ? String(b.videoId) : null;
  const productType = typeof b?.productType === "string" ? b.productType.trim().slice(0, 120) : "";
  const productIds: string[] = (Array.isArray(b?.productIds) ? b.productIds : []).filter(uuidOk).slice(0, 500);

  if (!videoId && !productIds.length) {
    return NextResponse.json({ ok: false, error: "nothing to do — pass productIds to clear, or videoId to assign" }, { status: 400 });
  }
  if (videoId) {
    const [v] = await db.select({ id: schema.productVideos.id })
      .from(schema.productVideos).where(eq(schema.productVideos.id, videoId)).limit(1);
    if (!v) return NextResponse.json({ ok: false, error: "video not found" }, { status: 404 });
  }

  // v272 · GẮN NGUỒN (source product) — giờ gắn ở CẤP CARD: video thuộc card thì listing set lên
  // card + đồng bộ xuống MỌI video con (bất biến: card.productId == mọi con.productId → captions/
  // UTM/push per-video chạy y cũ). Video còn lẻ thì tự tạo card 1 thành viên rồi gắn (mô hình mới:
  // đã có listing là có card). KHÔNG đụng shopify_products.video_id — hero trên Shopify giữ nguyên.
  if (videoId && uuidOk(b?.sourceProductId)) {
    const srcConds = [eq(schema.shopifyProducts.id, String(b.sourceProductId))];
    const scope0 = await storeOwnerScopeIds(session);
    if (scope0) {
      const mine0 = await db.select({ id: schema.stores.id }).from(schema.stores)
        .where(and(eq(schema.stores.marketplace, "shopify"), inArray(schema.stores.sellerId, scope0)));
      const ids0 = mine0.map((s) => s.id);
      if (!ids0.length) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      srcConds.push(inArray(schema.shopifyProducts.storeId, ids0));
    }
    const [p] = await db.select({ id: schema.shopifyProducts.id, storeId: schema.shopifyProducts.storeId })
      .from(schema.shopifyProducts).where(and(...srcConds)).limit(1);
    if (!p) return NextResponse.json({ ok: false, error: "listing not found" }, { status: 404 });

    const [vRow] = await db.select({
      cardId: schema.productVideos.cardId,
      sellerId: schema.productVideos.sellerId, creatorId: schema.productVideos.creatorId,
    }).from(schema.productVideos).where(eq(schema.productVideos.id, videoId)).limit(1);
    if (!vRow) return NextResponse.json({ ok: false, error: "video not found" }, { status: 404 });

    let cardId = vRow.cardId;
    if (!cardId) {
      const card = await createCard({ sellerId: vRow.sellerId, creatorId: vRow.creatorId, storeId: p.storeId, productId: p.id });
      cardId = card.id;
      await db.update(schema.productVideos).set({ cardId, cardSeq: 1 })
        .where(eq(schema.productVideos.id, videoId));
    }
    await db.update(schema.videoCards)
      .set({ productId: p.id, storeId: p.storeId, updatedAt: new Date() })
      .where(eq(schema.videoCards.id, cardId));
    // Đồng bộ listing xuống TẤT CẢ video con của card (không chỉ video đang mở).
    await db.update(schema.productVideos)
      .set({ productId: p.id, storeId: p.storeId, updatedAt: new Date() })
      .where(eq(schema.productVideos.cardId, cardId));
    return NextResponse.json({ ok: true, changed: 1, source: true });
  }

  // Phạm vi listing được phép đụng vào — seller chỉ sửa store của mình.
  const conds = [isNotNull(schema.shopifyProducts.shopifyProductId), ne(schema.shopifyProducts.shopifyProductId, "")];
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds) {
    const mine = await db.select({ id: schema.stores.id }).from(schema.stores)
      .where(and(eq(schema.stores.marketplace, "shopify"), inArray(schema.stores.sellerId, scopeIds)));
    const ids = mine.map((s) => s.id);
    if (!ids.length) return NextResponse.json({ ok: true, changed: 0 });
    conds.push(inArray(schema.shopifyProducts.storeId, ids));
  }

  if (productIds.length) conds.push(inArray(schema.shopifyProducts.id, productIds));
  else if (productType) conds.push(sql`lower(trim(${schema.shopifyProducts.productType})) = ${productType.toLowerCase()}`);
  else return NextResponse.json({ ok: false, error: "pass productIds or productType" }, { status: 400 });

  const target = await db.select({ id: schema.shopifyProducts.id, storeId: schema.shopifyProducts.storeId })
    .from(schema.shopifyProducts).where(and(...conds));
  if (!target.length) return NextResponse.json({ ok: true, changed: 0, note: "no matching listing" });

  await db.update(schema.shopifyProducts)
    .set({ videoId, videoMediaId: null, videoPushedAt: null, updatedAt: new Date() })
    .where(inArray(schema.shopifyProducts.id, target.map((t) => t.id)));

  // Gán → set luôn LISTING CHÍNH của video (productId/storeId) = listing đầu tiên. Cần cho link UTM +
  // caption ("listing chính"). v272: video ĐÃ thuộc card thì KHÔNG ghi đè productId ở đây — listing
  // của video do card quản (đồng bộ cả card), gán hero hàng loạt không được phá bất biến đó.
  if (videoId) {
    await db.update(schema.productVideos)
      .set({ productId: target[0].id, storeId: target[0].storeId, updatedAt: new Date() })
      .where(and(eq(schema.productVideos.id, videoId), sql`${schema.productVideos.cardId} IS NULL`));
  }

  return NextResponse.json({ ok: true, changed: target.length });
}

/** GET /api/videos/assign?videoId= → listing đang gán video này + danh sách Product type để chọn nhanh. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "videos")) < 1) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const videoId = req.nextUrl.searchParams.get("videoId") ?? "";

  const conds = [isNotNull(schema.shopifyProducts.shopifyProductId), ne(schema.shopifyProducts.shopifyProductId, "")];
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds) {
    const mine = await db.select({ id: schema.stores.id }).from(schema.stores)
      .where(and(eq(schema.stores.marketplace, "shopify"), inArray(schema.stores.sellerId, scopeIds)));
    const ids = mine.map((s) => s.id);
    if (!ids.length) return NextResponse.json({ ok: true, types: [], listings: [] });
    conds.push(inArray(schema.shopifyProducts.storeId, ids));
  }

  // Product type + số listing mỗi type (để nút "gán cho cả type" cho biết sẽ đụng bao nhiêu listing).
  const types = await db.select({
    productType: schema.shopifyProducts.productType,
    n: sql<number>`count(*)::int`,
    withVideo: sql<number>`count(${schema.shopifyProducts.videoId})::int`,
  }).from(schema.shopifyProducts).where(and(...conds))
    .groupBy(schema.shopifyProducts.productType);

  const listings = /^[0-9a-f-]{36}$/i.test(videoId)
    ? await db.select({
        id: schema.shopifyProducts.id, title: schema.shopifyProducts.title,
        productType: schema.shopifyProducts.productType,
        pushedAt: schema.shopifyProducts.videoPushedAt,
      }).from(schema.shopifyProducts)
        .where(and(...conds, eq(schema.shopifyProducts.videoId, videoId)))
        .limit(500)
    : [];

  // TÌM listing theo tên — để gõ đúng cái cần gán, khỏi đi dò trên Shopify (1 video 1 listing).
  // Trả kèm videoId của listing để cảnh báo listing đã có video khác.
  const qRaw = (req.nextUrl.searchParams.get("q") ?? "").trim().replace(/[%_]/g, " ").slice(0, 80);
  const matches = qRaw.length >= 2
    ? await db.select({
        id: schema.shopifyProducts.id, title: schema.shopifyProducts.title,
        productType: schema.shopifyProducts.productType,
        videoId: schema.shopifyProducts.videoId,
      }).from(schema.shopifyProducts)
        .where(and(...conds, sql`${schema.shopifyProducts.title} ilike ${"%" + qRaw + "%"}`))
        .orderBy(schema.shopifyProducts.title)
        .limit(20)
    : [];

  return NextResponse.json({
    ok: true,
    types: types.filter((t) => (t.productType ?? "").trim()).sort((a, b) => b.n - a.n),
    listings,
    matches,
  });
}
