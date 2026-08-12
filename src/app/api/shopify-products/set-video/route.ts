import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopHost, type ShopifyCred } from "@/lib/shopify";
import { pushVideoToShopify } from "@/lib/shopify-video";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/shopify-products/set-video { id, videoCode }
 *
 * Gắn video từ Video Library vào 1 listing bằng cách DÁN VIDEO ID (#videoCode) — giống dán SKU design.
 * Đây là đường để seller gắn video ngay tại Manage Products · Shopify (không phải vào Video Library).
 *   · videoCode rỗng/0  → GỠ video khỏi listing (video_id = null).
 *   · videoCode hợp lệ  → set shopify_products.video_id, và set luôn LISTING CHÍNH của video
 *                         (productId/storeId) để link UTM + caption chạy được.
 * Đổi video ⇒ xoá dấu media Shopify cũ (video_media_id / video_pushed_at) để lần Push sau đẩy bản mới.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  // Listing phải thuộc store trong phạm vi của seller.
  const [prod] = await db.select({
    id: schema.shopifyProducts.id, storeId: schema.shopifyProducts.storeId, seller: schema.stores.sellerId,
    gid: schema.shopifyProducts.shopifyProductId, title: schema.shopifyProducts.title, cred: schema.stores.apiCredentials,
  })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(eq(schema.shopifyProducts.id, id)).limit(1);
  if (!prod) return NextResponse.json({ ok: false, error: "listing not found" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!prod.seller || !scopeIds.includes(prod.seller))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const codeRaw = b?.videoCode;
  const code = Number(String(codeRaw ?? "").replace(/[^0-9]/g, ""));

  // GỠ video.
  if (!codeRaw || !code) {
    // Video đang gắn trước khi xoá — để gỡ luôn "listing chính" của video nếu chính là listing này.
    const [before] = await db.select({ vid: schema.shopifyProducts.videoId })
      .from(schema.shopifyProducts).where(eq(schema.shopifyProducts.id, id)).limit(1);
    await db.update(schema.shopifyProducts)
      .set({ videoId: null, videoMediaId: null, videoPushedAt: null, updatedAt: new Date() })
      .where(eq(schema.shopifyProducts.id, id));
    // Nếu listing này ĐANG là listing chính của video (productId trỏ về đây) → gỡ luôn productId/storeId
    // để LISTING + Generate + Performance trong Video Library nhất quán (không còn trỏ về listing đã gỡ).
    if (before?.vid) {
      await db.update(schema.productVideos)
        .set({ productId: null, storeId: null, updatedAt: new Date() })
        .where(and(eq(schema.productVideos.id, before.vid), eq(schema.productVideos.productId, id)));
    }
    return NextResponse.json({ ok: true, cleared: true });
  }

  // Tìm video theo #videoCode.
  const [vid] = await db.select({
    id: schema.productVideos.id, code: schema.productVideos.videoCode, title: schema.productVideos.title,
    thumbUrl: schema.productVideos.thumbUrl, publicUrl: schema.productVideos.publicUrl,
    storageKey: schema.productVideos.storageKey, contentType: schema.productVideos.contentType,
  })
    .from(schema.productVideos).where(eq(schema.productVideos.videoCode, code)).limit(1);
  if (!vid) return NextResponse.json({ ok: false, error: `Video #${code} not found in Video Library` }, { status: 404 });

  await db.update(schema.shopifyProducts)
    .set({ videoId: vid.id, videoMediaId: null, videoPushedAt: null, updatedAt: new Date() })
    .where(eq(schema.shopifyProducts.id, id));

  // Set listing chính của video (để UTM + caption biết trỏ về đâu). 1 listing 1 video.
  // Đồng thời LẤY LUÔN Title của listing làm title video — 1 video 1 listing nên tên listing dễ nhận
  // hơn tên file thô (copy_UUID). Listing không có title thì giữ tên cũ.
  const newTitle = (prod.title ?? "").trim() || vid.title;
  await db.update(schema.productVideos)
    .set({ productId: prod.id, storeId: prod.storeId, title: newTitle, updatedAt: new Date() })
    .where(eq(schema.productVideos.id, vid.id));

  // ── ĐẨY LUÔN video lên Shopify media ── video có SAU khi listing đã live, nên đây là chỗ đẩy (không
  // gộp vào Push nội dung listing). Listing đã có GID + store cấu hình API thì đẩy ngay; lỗi/chưa cấu
  // hình thì vẫn gắn xong, báo để đẩy lại sau (nút trong modal).
  let push: { ok: boolean; note?: string; error?: string } | undefined;
  const cred = (prod.cred ?? {}) as ShopifyCred;
  if (prod.gid && shopHost(cred) && (cred.adminToken || (cred.clientId && cred.clientSecret)) && vid.publicUrl) {
    try {
      const r = await pushVideoToShopify(cred, {
        productGid: String(prod.gid), videoUrl: String(vid.publicUrl),
        filename: (vid.storageKey ?? "").split("/").pop() ?? "video.mp4",
        mimeType: vid.contentType ?? "video/mp4", alt: vid.title || prod.title || undefined,
      });
      if (r.ok) {
        await db.update(schema.shopifyProducts).set({ videoMediaId: r.mediaId ?? null, videoPushedAt: new Date() }).where(eq(schema.shopifyProducts.id, id));
        await db.update(schema.productVideos).set({ shopifyPushedAt: new Date(), updatedAt: new Date() }).where(eq(schema.productVideos.id, vid.id));
        push = { ok: true, note: "Shopify is processing — the video appears on the product page in a few minutes." };
      } else push = { ok: false, error: r.error ?? "push failed" };
    } catch (e) { push = { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) }; }
  } else if (!prod.gid) {
    push = { ok: false, error: "Listing is not on Shopify yet — push the listing first, then attach the video." };
  }

  return NextResponse.json({ ok: true, video: { code: vid.code, title: newTitle, thumbUrl: vid.thumbUrl }, push });
}

// Dùng để hiện video đang gắn khi mở nhiều listing (không bắt buộc, giữ cho tương lai).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false }, { status: 403 });
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
  if (!ids.length) return NextResponse.json({ ok: true, map: {} });
  const rows = await db.select({
    pid: schema.shopifyProducts.id, code: schema.productVideos.videoCode,
    title: schema.productVideos.title, thumbUrl: schema.productVideos.thumbUrl,
    pushedAt: schema.shopifyProducts.videoPushedAt,
  }).from(schema.shopifyProducts)
    .leftJoin(schema.productVideos, eq(schema.productVideos.id, schema.shopifyProducts.videoId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const map: Record<string, unknown> = {};
  for (const r of rows) if (r.code != null) map[r.pid] = { code: r.code, title: r.title, thumbUrl: r.thumbUrl, pushed: !!r.pushedAt };
  return NextResponse.json({ ok: true, map });
}
