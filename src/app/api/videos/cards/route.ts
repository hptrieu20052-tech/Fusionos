import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { addVideoToCard, createCard, detachVideoFromCard } from "@/lib/video-cards";

export const dynamic = "force-dynamic";

/**
 * v272 · Thao tác CARD (card cha — video con).
 *
 *   POST { videoIds: [a, b, …] }        → tạo card MỚI từ các video lẻ (video đầu = anchor:
 *                                          seller/creator/store/product của card lấy từ nó)
 *   POST { videoId, cardId }            → thêm 1 video lẻ vào card có sẵn (nhận số con kế tiếp)
 *   POST { videoId, detach: true }      → tách video khỏi card (card rỗng thì tự xoá)
 *   DELETE ?id=<cardId>                 → giải tán card: mọi video về "lẻ", xoá card
 *
 * Dùng cho kéo-thả ở Video Library: thả video lẻ vào card = join; thả 2 video lẻ vào nhau = tạo card.
 * KHÔNG đụng shopify_products.video_id (video hero trên trang Shopify) — card chỉ là tổ chức thư viện.
 */

const uuidOk = (x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x));

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "videos")) < 2) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);

  // ── Tách video khỏi card ──
  if (uuidOk(b?.videoId) && b?.detach === true) {
    const removed = await detachVideoFromCard(String(b.videoId));
    return NextResponse.json({ ok: true, detached: true, cardRemoved: removed });
  }

  // ── Thêm video lẻ vào card có sẵn ──
  if (uuidOk(b?.videoId) && uuidOk(b?.cardId)) {
    const [v] = await db.select({ id: schema.productVideos.id, cardId: schema.productVideos.cardId })
      .from(schema.productVideos).where(eq(schema.productVideos.id, String(b.videoId))).limit(1);
    if (!v) return NextResponse.json({ ok: false, error: "video not found" }, { status: 404 });
    if (v.cardId) return NextResponse.json({ ok: false, error: "video is already in a card — detach it first" }, { status: 409 });
    try {
      const seq = await addVideoToCard(v.id, String(b.cardId));
      return NextResponse.json({ ok: true, cardId: String(b.cardId), cardSeq: seq });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 404 });
    }
  }

  // ── Tạo card mới từ các video lẻ ──
  const videoIds: string[] = (Array.isArray(b?.videoIds) ? b.videoIds : []).filter(uuidOk).slice(0, 100);
  if (videoIds.length < 1) {
    return NextResponse.json({ ok: false, error: "pass videoIds to create, or videoId+cardId to join, or videoId+detach" }, { status: 400 });
  }
  const vids = await db.select().from(schema.productVideos).where(inArray(schema.productVideos.id, videoIds));
  if (vids.length !== videoIds.length) return NextResponse.json({ ok: false, error: "some videos not found" }, { status: 404 });
  if (vids.some((v) => v.cardId)) {
    return NextResponse.json({ ok: false, error: "a video is already in a card — detach it first" }, { status: 409 });
  }
  // Giữ đúng thứ tự client gửi lên: video ĐẦU là anchor (thumbnail + danh tính card).
  const byId = new Map(vids.map((v) => [v.id, v]));
  const ordered = videoIds.map((id) => byId.get(id)!);
  const anchor = ordered[0];

  const card = await createCard({
    sellerId: anchor.sellerId, creatorId: anchor.creatorId,
    storeId: anchor.storeId, productId: anchor.productId,
  });
  for (let i = 0; i < ordered.length; i++) {
    await db.update(schema.productVideos).set({
      cardId: card.id, cardSeq: i + 1,
      // Anchor có listing thì cả card dùng chung listing đó (bất biến đồng bộ product của card).
      ...(anchor.productId ? { productId: anchor.productId, storeId: anchor.storeId } : {}),
      updatedAt: new Date(),
    }).where(eq(schema.productVideos.id, ordered[i].id));
  }
  return NextResponse.json({ ok: true, cardId: card.id, code: card.code, members: ordered.length });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "videos")) < 2) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!uuidOk(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const [card] = await db.select({ id: schema.videoCards.id }).from(schema.videoCards)
    .where(eq(schema.videoCards.id, String(id))).limit(1);
  if (!card) return NextResponse.json({ ok: false, error: "card not found" }, { status: 404 });
  await db.update(schema.productVideos).set({ cardId: null, cardSeq: null, updatedAt: new Date() })
    .where(eq(schema.productVideos.cardId, card.id));
  await db.delete(schema.videoCards).where(eq(schema.videoCards.id, card.id));
  return NextResponse.json({ ok: true });
}
