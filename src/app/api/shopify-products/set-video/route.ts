import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds, sharedStoreIds } from "@/lib/scope";
import { shopHost, shopifyGraphQL, type ShopifyCred } from "@/lib/shopify";
import { pushVideoToShopify } from "@/lib/shopify-video";

// v676 · gỡ video khỏi MEDIA GALLERY Shopify (video dọc 9:16 nằm trong gallery vuông làm lệch layout
// listing — hướng mới: video nằm trong DESCRIPTION qua nút "+ Vào mô tả", gallery chỉ còn ảnh).
const MEDIA_DELETE = `mutation MD($productId: ID!, $mediaIds: [ID!]!) {
  productDeleteMedia(productId: $productId, mediaIds: $mediaIds) { deletedMediaIds userErrors { field message } }
}`;

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
    id: schema.shopifyProducts.id, storeId: schema.shopifyProducts.storeId, seller: schema.stores.sellerId, sStoreId: schema.stores.id,
    gid: schema.shopifyProducts.shopifyProductId, title: schema.shopifyProducts.title, cred: schema.stores.apiCredentials,
    videoMediaId: schema.shopifyProducts.videoMediaId,
    createdBy: schema.shopifyProducts.createdBy, etsyPid: schema.shopifyProducts.etsyProductId,
  })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(eq(schema.shopifyProducts.id, id)).limit(1);
  if (!prod) return NextResponse.json({ ok: false, error: "listing not found" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  const shared = await sharedStoreIds(scopeIds);
  // v683 · STORE SHARE (Talewix nhiều seller): rule cũ chỉ cho CHỦ STORE nên seller bị chặn
  // "store được share chỉ xem" khi upload/gắn video. Áp đúng rule sở hữu của PATCH listing (v567/v631):
  // seller thao tác được listing MÌNH TẠO (created_by), hoặc listing chưa gán chủ nhưng listing Etsy
  // gốc thuộc store của mình.
  if (session.role !== "admin" && scopeIds && prod.seller !== session.sub && prod.createdBy !== session.sub) {
    let chainOwner: string | null = null;
    if (!prod.createdBy && (prod.etsyPid || prod.gid)) {
      try {
        const [e] = await db.select({ sellerId: schema.stores.sellerId }).from(schema.etsyProducts)
          .leftJoin(schema.stores, eq(schema.stores.id, schema.etsyProducts.storeId))
          .where(prod.etsyPid ? eq(schema.etsyProducts.id, prod.etsyPid) : eq(schema.etsyProducts.shopifyProductId, String(prod.gid)))
          .limit(1);
        chainOwner = e?.sellerId ?? null;
      } catch { /* best-effort */ }
    }
    if (chainOwner !== session.sub) {
      return NextResponse.json({ ok: false, error: "forbidden: this listing was created by someone else — only its creator or an admin can change its video" }, { status: 403 });
    }
  }
  if (scopeIds && !((prod.seller && scopeIds.includes(prod.seller)) || (prod.sStoreId && shared.includes(prod.sStoreId)))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // v676 · GỠ VIDEO KHỎI GALLERY SHOPIFY (giữ nguyên video gắn trong FUSION + bản trong mô tả).
  if (String(b?.action ?? "") === "removeShopifyMedia") {
    const mediaId = String(prod.videoMediaId ?? "");
    if (!mediaId) return NextResponse.json({ ok: false, error: "no video in the Shopify gallery for this listing" }, { status: 400 });
    const cred = (prod.cred ?? {}) as ShopifyCred;
    if (!prod.gid || !shopHost(cred)) return NextResponse.json({ ok: false, error: "store is not connected to Shopify API" }, { status: 400 });
    try {
      const r = await shopifyGraphQL<{ productDeleteMedia?: { userErrors?: { message?: string }[] } }>(
        cred, MEDIA_DELETE, { productId: String(prod.gid), mediaIds: [mediaId] },
      );
      const errs = (r.productDeleteMedia?.userErrors ?? []).map((e) => e.message).filter(Boolean).join("; ");
      if (errs) return NextResponse.json({ ok: false, error: errs.slice(0, 200) }, { status: 400 });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 400 });
    }
    await db.update(schema.shopifyProducts)
      .set({ videoMediaId: null, videoPushedAt: null, updatedAt: new Date() })
      .where(eq(schema.shopifyProducts.id, id));
    return NextResponse.json({ ok: true, removed: true });
  }

  // v677 · UPLOAD THẲNG TRÊN LISTING: client đã PUT file lên R2 (qua /api/videos/upload-url),
  // đây là bước tạo bản ghi Video Library + gắn ngay vào listing. Seller dùng được (ownership đã check).
  if (String(b?.action ?? "") === "uploadAttach") {
    const storageKey = String(b?.storageKey ?? "").trim();
    const publicUrl = String(b?.publicUrl ?? "").trim();
    if (!storageKey || !publicUrl.startsWith("http")) return NextResponse.json({ ok: false, error: "storageKey + publicUrl required" }, { status: 400 });
    const numOr = (x: unknown, max: number) => { const n = Number(x); return isFinite(n) && n > 0 && n <= max ? Math.round(n) : null; };
    const w = numOr(b?.width, 20000), h = numOr(b?.height, 20000);
    const aspect = (!w || !h) ? null
      : Math.abs(w / h - 9 / 16) < 0.06 ? "9:16"
      : Math.abs(w / h - 1) < 0.06 ? "1:1"
      : Math.abs(w / h - 16 / 9) < 0.08 ? "16:9" : "other";
    const dRaw = Number(b?.durationSec);
    const title = (prod.title ?? "").trim() || "Listing video";
    const [vid] = await db.insert(schema.productVideos).values({
      sellerId: prod.seller ?? (session.role === "seller" ? session.sub : null),
      creatorId: session.sub, uploadedBy: session.sub,
      productId: prod.id, storeId: prod.storeId,
      title, storageKey, publicUrl,
      thumbKey: String(b?.thumbKey ?? "").trim() || null, thumbUrl: String(b?.thumbUrl ?? "").trim() || null,
      contentType: String(b?.contentType ?? "").trim() || "video/mp4",
      sizeBytes: numOr(b?.sizeBytes, 10_000_000_000),
      durationSec: isFinite(dRaw) && dRaw > 0 ? dRaw.toFixed(2) : null,
      width: w, height: h, aspect,
      status: "approved", // video listing của chính chủ — không treo pending như hàng creator nộp duyệt
    }).returning({ id: schema.productVideos.id, code: schema.productVideos.videoCode });
    // v680 · adsOnly: listing ĐÃ có video chính → video mới chỉ nằm trong Video Library (trỏ về
    // sản phẩm) để chạy ads qua Meta Ads kit — KHÔNG gắn đè videoId, không đụng listing/mô tả.
    if (b?.adsOnly !== true) {
      await db.update(schema.shopifyProducts)
        .set({ videoId: vid.id, videoMediaId: null, videoPushedAt: null, updatedAt: new Date() })
        .where(eq(schema.shopifyProducts.id, id));
    }
    return NextResponse.json({ ok: true, adsOnly: b?.adsOnly === true, video: { code: vid.code, title, thumbUrl: String(b?.thumbUrl ?? "").trim() || null, publicUrl } });
  }

  const raw = String(b?.videoCode ?? "").trim();

  // GỠ video khi để trống.
  if (!raw) {
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

  // Phân giải video: chấp nhận #số (videoCode) HOẶC mã thẻ "QT-XX-01.<seq>" (chỉ "QT-XX-01" → lấy video con đầu).
  type VRow = { id: string; code: number; title: string; thumbUrl: string | null; publicUrl: string | null; storageKey: string | null; contentType: string | null };
  const vsel = {
    id: schema.productVideos.id, code: schema.productVideos.videoCode, title: schema.productVideos.title,
    thumbUrl: schema.productVideos.thumbUrl, publicUrl: schema.productVideos.publicUrl,
    storageKey: schema.productVideos.storageKey, contentType: schema.productVideos.contentType,
  };
  let found: VRow[];
  if (/^\d+$/.test(raw)) {
    found = await db.select(vsel).from(schema.productVideos)
      .where(eq(schema.productVideos.videoCode, Number(raw))).limit(1);
  } else {
    const up = raw.toUpperCase();
    const m = up.match(/^(.+?)\.(\d+)$/);
    const cardCode = (m ? m[1] : up).trim();
    const seq = m ? Number(m[2]) : null;
    const conds = seq != null
      ? and(eq(schema.videoCards.code, cardCode), eq(schema.productVideos.cardSeq, seq))
      : eq(schema.videoCards.code, cardCode);
    found = await db.select(vsel).from(schema.productVideos)
      .leftJoin(schema.videoCards, eq(schema.videoCards.id, schema.productVideos.cardId))
      .where(conds).orderBy(asc(schema.productVideos.cardSeq)).limit(1);
  }
  const vid = found[0];
  if (!vid) return NextResponse.json({ ok: false, error: `Video "${raw}" không có trong Video Library` }, { status: 404 });

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

  // ── v676 · KHÔNG tự đẩy video vào MEDIA GALLERY nữa ── video dọc trong gallery vuông làm lệch
  // layout listing. Hướng mới: video vào DESCRIPTION qua nút "+ Vào mô tả" (Save là lên Shopify).
  // Vẫn giữ đường đẩy gallery cho ai cần: client gửi pushMedia:true mới đẩy.
  let push: { ok: boolean; note?: string; error?: string } | undefined;
  const cred = (prod.cred ?? {}) as ShopifyCred;
  if (b?.pushMedia === true && prod.gid && shopHost(cred) && (cred.adminToken || (cred.clientId && cred.clientSecret)) && vid.publicUrl) {
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
  } else if (b?.pushMedia === true && !prod.gid) {
    push = { ok: false, error: "Listing is not on Shopify yet — push the listing first, then attach the video." };
  }

  return NextResponse.json({ ok: true, video: { code: vid.code, title: newTitle, thumbUrl: vid.thumbUrl, publicUrl: vid.publicUrl, mime: vid.contentType ?? "video/mp4" }, push });
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
