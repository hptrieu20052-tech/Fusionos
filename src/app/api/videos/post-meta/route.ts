import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { metaCfg, igPublishReel, fbPublishReel } from "@/lib/meta-publish";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // IG poll có thể vài phút (Meta tải video từ R2 rồi xử lý)

/**
 * v273 · POST /api/videos/post-meta { id } — nút "Post to Meta (FB+IG)":
 * đăng video lên CẢ Instagram Reel + Facebook Page Reel trong 1 lần bấm.
 *
 * Caption lấy từ captions CỦA CHÍNH VIDEO (per-video, v272c):
 *   · IG  = captions.instagram (text + hashtags, KHÔNG kèm link — link ở bio)
 *   · FB  = captions.facebook (text + link UTM utm_source=meta + hashtags)
 * Chưa có captions → chặn, bắt Generate trước (đăng không caption là phí bài).
 *
 * Đăng xong ghi postedTo.meta = { url, at } (data này UI đang ẩn nhưng vẫn lưu — bật lại là thấy).
 * CHỈ ADMIN — cửa duy nhất đẩy nội dung ra kênh public, giữ giống Distribution cũ.
 */

type Caption = { text?: string; hashtags?: string[] };

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const cfg = metaCfg();
  if (!cfg) {
    return NextResponse.json({
      ok: false,
      error: "Meta chưa kết nối — cần 3 env trên Vercel: META_ACCESS_TOKEN, META_IG_USER_ID, META_PAGE_ID (lấy sau khi Business Verification + App Review; xem meta-token-guide).",
    }, { status: 400 });
  }

  const [row] = await db.select({
    v: schema.productVideos,
    productUrl: schema.shopifyProducts.onlineStoreUrl,
  }).from(schema.productVideos)
    .leftJoin(schema.shopifyProducts, eq(schema.shopifyProducts.id, schema.productVideos.productId))
    .where(eq(schema.productVideos.id, id)).limit(1);
  if (!row) return NextResponse.json({ ok: false, error: "video not found" }, { status: 404 });

  const videoUrl = row.v.publicUrl ?? "";
  if (!/^https?:\/\//i.test(videoUrl)) {
    return NextResponse.json({ ok: false, error: "video has no public URL (R2) — re-upload it" }, { status: 400 });
  }

  const caps = (row.v.captions ?? {}) as Record<string, Caption>;
  const igCap = caps.instagram, fbCap = caps.facebook;
  if (!igCap?.text && !fbCap?.text) {
    return NextResponse.json({ ok: false, error: "no captions yet — Generate captions first, then post" }, { status: 400 });
  }

  // Link UTM cho FB (IG không kèm link — thuật toán IG dìm caption chứa URL; link để ở bio).
  let utm = "";
  if (row.productUrl) {
    try {
      const u = new URL(row.productUrl);
      u.searchParams.set("utm_source", "meta");
      u.searchParams.set("utm_medium", "video");
      u.searchParams.set("utm_campaign", `video_${row.v.videoCode}`);
      utm = u.toString();
    } catch { /* URL hỏng thì bỏ link, không chặn đăng */ }
  }
  const igText = [igCap?.text ?? fbCap?.text ?? row.v.title, (igCap?.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");
  const fbText = [fbCap?.text ?? igCap?.text ?? row.v.title, utm, (fbCap?.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");

  // Đăng lần lượt: IG trước (lâu nhất — có poll), FB sau. Kênh nào lỗi báo riêng kênh đó,
  // kênh kia vẫn giữ kết quả — không "all or nothing" để 1 kênh trục trặc không phá kênh kia.
  const out: { ig?: { url: string | null }; fb?: { url: string }; errors: string[] } = { errors: [] };
  try {
    const ig = await igPublishReel(cfg, videoUrl, igText);
    out.ig = { url: ig.permalink };
  } catch (e) { out.errors.push("IG: " + String((e as Error)?.message ?? e).slice(0, 300)); }
  try {
    const fb = await fbPublishReel(cfg, videoUrl, fbText);
    out.fb = { url: fb.url };
  } catch (e) { out.errors.push("FB: " + String((e as Error)?.message ?? e).slice(0, 300)); }

  if (out.ig || out.fb) {
    const posted = { ...((row.v.postedTo as Record<string, { url: string; at: string }>) ?? {}) };
    const link = out.ig?.url ?? out.fb?.url ?? "";
    if (link) posted.meta = { url: link, at: new Date().toISOString() };
    await db.update(schema.productVideos)
      .set({ postedTo: posted, updatedAt: new Date() })
      .where(eq(schema.productVideos.id, id));
  }

  if (!out.ig && !out.fb) {
    return NextResponse.json({ ok: false, error: out.errors.join(" · ") || "both channels failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, ig: out.ig ?? null, fb: out.fb ?? null, errors: out.errors });
}
