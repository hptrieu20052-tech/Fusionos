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
 * v209 · POST /api/videos/push-shopify { id }  → đẩy video vào MỌI listing đang gán video này
 *        (shopify_products.video_id = id) mà chưa có media. Bỏ qua listing đã đẩy rồi.
 *        GET  /api/videos/push-shopify?id=&productId= → trạng thái transcode của một listing.
 *
 * Không còn bước duyệt: seller và creator tự chỉnh với nhau rồi update, video nào cũng đẩy được.
 */
async function loadTargets(videoId: string) {
  return db.select({
    rowId: schema.shopifyProducts.id,
    productGid: schema.shopifyProducts.shopifyProductId,
    productTitle: schema.shopifyProducts.title,
    mediaId: schema.shopifyProducts.videoMediaId,
    cred: schema.stores.apiCredentials,
    mk: schema.stores.marketplace,
  }).from(schema.shopifyProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(eq(schema.shopifyProducts.videoId, videoId))
    .limit(50);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "videos")) < 2) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const [v] = await db.select().from(schema.productVideos).where(eq(schema.productVideos.id, id)).limit(1);
  if (!v) return NextResponse.json({ ok: false, error: "video not found" }, { status: 404 });

  const targets = await loadTargets(id);
  if (!targets.length) {
    return NextResponse.json({ ok: false, error: "no listing is using this video yet — assign it to listings first" }, { status: 400 });
  }
  const todo = targets.filter((t) => !t.mediaId && t.productGid);
  if (!todo.length) {
    return NextResponse.json({ ok: true, pushed: 0, skipped: targets.length, note: "every listing already has this video" });
  }

  let pushed = 0;
  const errors: string[] = [];
  for (const t of todo) {
    const cred = (t.cred ?? {}) as ShopifyCred;
    if (t.mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
      errors.push(`${(t.productTitle ?? "").slice(0, 30)}: store not configured`); continue;
    }
    const r = await pushVideoToShopify(cred, {
      productGid: String(t.productGid),
      videoUrl: String(v.publicUrl ?? ""),
      filename: (v.storageKey ?? "").split("/").pop() ?? "video.mp4",
      mimeType: v.contentType ?? "video/mp4",
      alt: v.title || t.productTitle || undefined,
    });
    if (!r.ok) { if (errors.length < 4) errors.push(`${(t.productTitle ?? "").slice(0, 30)}: ${r.error ?? "failed"}`); continue; }
    await db.update(schema.shopifyProducts)
      .set({ videoMediaId: r.mediaId ?? null, videoPushedAt: new Date() })
      .where(eq(schema.shopifyProducts.id, t.rowId));
    pushed++;
  }

  if (pushed) {
    await db.update(schema.productVideos)
      .set({ shopifyPushedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.productVideos.id, id));
  }

  // Shopify còn phải transcode — báo rõ để không tưởng là hỏng khi mở store chưa thấy video.
  return NextResponse.json({
    ok: pushed > 0, pushed, failed: todo.length - pushed, skipped: targets.length - todo.length,
    ...(errors.length ? { error: errors.join("; ") } : {}),
    note: pushed ? "Shopify is still processing — the video appears on the product page in a few minutes." : undefined,
  });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "videos")) < 1) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const targets = await loadTargets(id);
  const first = targets.find((t) => t.mediaId);
  if (!first?.mediaId) return NextResponse.json({ ok: false, error: "not pushed yet" }, { status: 400 });

  const cred = (first.cred ?? {}) as ShopifyCred;
  const st = await videoMediaStatus(cred, first.mediaId);
  return NextResponse.json({ ok: true, listings: targets.length, pushed: targets.filter((t) => t.mediaId).length, ...st });
}
