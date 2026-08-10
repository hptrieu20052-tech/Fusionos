import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { shopHost, type ShopifyCred } from "@/lib/shopify";
import { pushVideoToShopify, videoMediaStatus } from "@/lib/shopify-video";

export const dynamic = "force-dynamic";
// Tải video từ R2 về hàm rồi đẩy sang staged upload của Shopify — file to thì lâu, 60s không đủ.
export const maxDuration = 300;

/**
 * v207 · POST /api/videos/push-shopify { id }  → gắn video vào listing Shopify làm product media.
 *        GET  /api/videos/push-shopify?id=     → hỏi trạng thái xử lý (Shopify transcode mất vài phút).
 *
 * Chặn: chỉ video đã DUYỆT (approved) mới được đẩy. Video pending mà lọt lên store là hỏng đúng
 * cái mà bước duyệt sinh ra để tránh.
 */
async function loadOne(id: string) {
  const [row] = await db.select({
    v: schema.productVideos,
    productGid: schema.shopifyProducts.shopifyProductId,
    productTitle: schema.shopifyProducts.title,
    cred: schema.stores.apiCredentials,
    mk: schema.stores.marketplace,
  }).from(schema.productVideos)
    .leftJoin(schema.shopifyProducts, eq(schema.shopifyProducts.id, schema.productVideos.productId))
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(eq(schema.productVideos.id, id)).limit(1);
  return row ?? null;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "videos")) < 2) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const row = await loadOne(id);
  if (!row) return NextResponse.json({ ok: false, error: "video not found" }, { status: 404 });
  if (row.v.status !== "approved") {
    return NextResponse.json({ ok: false, error: "video is not approved yet — approve it first" }, { status: 400 });
  }
  if (!row.v.productId || !row.productGid) {
    return NextResponse.json({ ok: false, error: "link this video to a Shopify listing first" }, { status: 400 });
  }
  if (row.v.shopifyMediaId) {
    return NextResponse.json({ ok: false, error: "already pushed to Shopify — delete the media in Shopify first if you want to re-push" }, { status: 400 });
  }
  const cred = (row.cred ?? {}) as ShopifyCred;
  if (row.mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
    return NextResponse.json({ ok: false, error: "store is not configured for the Shopify API" }, { status: 400 });
  }

  const r = await pushVideoToShopify(cred, {
    productGid: String(row.productGid),
    videoUrl: String(row.v.publicUrl ?? ""),
    filename: (row.v.storageKey ?? "").split("/").pop() ?? "video.mp4",
    mimeType: row.v.contentType ?? "video/mp4",
    alt: row.v.title || row.productTitle || undefined,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "push failed" }, { status: 400 });

  await db.update(schema.productVideos)
    .set({ shopifyMediaId: r.mediaId ?? null, shopifyPushedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.productVideos.id, id));

  // Shopify còn phải transcode — báo rõ để không tưởng là hỏng khi mở store chưa thấy video.
  return NextResponse.json({ ok: true, mediaId: r.mediaId, note: "Shopify is still processing the video — it appears on the product page once processing finishes (usually a few minutes)." });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "videos")) < 1) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const row = await loadOne(id);
  if (!row?.v.shopifyMediaId) return NextResponse.json({ ok: false, error: "not pushed yet" }, { status: 400 });

  const cred = (row.cred ?? {}) as ShopifyCred;
  const st = await videoMediaStatus(cred, row.v.shopifyMediaId);
  return NextResponse.json({ ok: true, ...st });
}
