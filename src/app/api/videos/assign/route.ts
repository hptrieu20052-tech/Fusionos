import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

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

  const target = await db.select({ id: schema.shopifyProducts.id })
    .from(schema.shopifyProducts).where(and(...conds));
  if (!target.length) return NextResponse.json({ ok: true, changed: 0, note: "no matching listing" });

  await db.update(schema.shopifyProducts)
    .set({ videoId, videoMediaId: null, videoPushedAt: null, updatedAt: new Date() })
    .where(inArray(schema.shopifyProducts.id, target.map((t) => t.id)));

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

  return NextResponse.json({
    ok: true,
    types: types.filter((t) => (t.productType ?? "").trim()).sort((a, b) => b.n - a.n),
    listings,
  });
}
