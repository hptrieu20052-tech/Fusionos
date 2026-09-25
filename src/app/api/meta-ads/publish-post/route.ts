import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { publishPagePost } from "@/lib/page-post";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * v587 · POST /api/meta-ads/publish-post — đăng NỘI DUNG của ad thành BÀI CÔNG KHAI.
 * Meta KHÔNG cho publish ngược dark post lên tường — nên làm chiều xuôi: lấy caption + link + ảnh
 * từ creative của ad rồi đăng bài organic thật.
 * v614 · { adId, fb?, ig?, when? }:
 *   - fb (mặc định true): đăng lên Facebook Page. when (ISO, tương lai ≥10 phút) → dùng đặt lịch
 *     NATIVE của Meta (scheduled_publish_time) — bài nằm trong Scheduled posts, đăng ĐÚNG giờ.
 *   - ig: đăng lên Instagram Business account link với Page (ảnh + caption; link là text).
 *     IG không có đặt lịch native → bài hẹn giờ vào bảng page_post_queue, cron tick đăng khi tới
 *     giờ (lệch tối đa 1 chu kỳ cron).
 * Cần token có pages_manage_posts (+ instagram_content_publish cho IG); thiếu → báo rõ, không đăng.
 */
const V = "v23.0";
const G = `https://graph.facebook.com/${V}`;

async function fb(path: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${G}/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(String(j.error?.message ?? res.status).slice(0, 250));
  return j as Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const token = process.env.META_SYSTEM_TOKEN ?? "";
  if (!token) return NextResponse.json({ ok: false, error: "Meta API not configured" }, { status: 400 });
  const b = await req.json().catch(() => null) as { adId?: string; fb?: boolean; ig?: boolean; when?: string; preview?: boolean } | null;
  const adId = String(b?.adId ?? "").replace(/\D/g, "");
  if (!adId) return NextResponse.json({ ok: false, error: "adId required" }, { status: 400 });
  const toFb = b?.fb !== false;
  const toIg = b?.ig === true;
  if (!toFb && !toIg) return NextResponse.json({ ok: false, error: "pick at least one channel (Facebook Page / Instagram)" }, { status: 400 });
  // when: ISO tuyệt đối (client đã tính từ giờ VN). Dưới 10 phút → coi như đăng ngay (FB yêu cầu ≥10').
  const whenMs = b?.when ? new Date(String(b.when)).getTime() : 0;
  const schedMs = whenMs > Date.now() + 10 * 60000 ? whenMs : 0;

  try {
    type Spec = { page_id?: string; link_data?: { message?: string; link?: string; picture?: string }; video_data?: { message?: string; image_url?: string; call_to_action?: { value?: { link?: string } } } };
    const ad = await fb(`${adId}?fields=name,creative{object_story_spec,effective_object_story_id,image_url,thumbnail_url}`, token);
    const cr = (ad.creative ?? {}) as { object_story_spec?: Spec; effective_object_story_id?: string; image_url?: string; thumbnail_url?: string };
    const spec = cr.object_story_spec ?? {};
    const pageId = String(spec.page_id ?? (cr.effective_object_story_id ?? "").split("_")[0] ?? "");
    const message = String(spec.link_data?.message ?? spec.video_data?.message ?? "").trim();
    const link = String(spec.link_data?.link ?? spec.video_data?.call_to_action?.value?.link ?? "").trim();
    // Ảnh cho IG: ảnh gốc creative > ảnh trong spec > thumbnail (ad video chỉ có thumbnail).
    const imageUrl = String(cr.image_url ?? spec.link_data?.picture ?? spec.video_data?.image_url ?? cr.thumbnail_url ?? "").trim();
    if (!pageId) return NextResponse.json({ ok: false, error: "Cannot resolve the Facebook Page from this ad's creative." }, { status: 400 });
    if (!message && !link) return NextResponse.json({ ok: false, error: "This ad's creative has no caption/link to publish." }, { status: 400 });

    // v615 · preview: trả nội dung SẼ ĐĂNG (caption + link + ảnh) + tình trạng link IG — không đăng gì.
    if (b?.preview === true) {
      let igLinked: boolean | null = null;
      try {
        const pg = await fb(`${pageId}?fields=instagram_business_account`, token);
        igLinked = !!((pg.instagram_business_account ?? {}) as { id?: string }).id;
      } catch { igLinked = null; }
      return NextResponse.json({ ok: true, preview: { message, link, imageUrl, pageId, igLinked } });
    }

    const warns: string[] = [];
    let fbPostId = "", igMediaId = "", igQueued = false;

    // FB: đăng ngay hoặc đặt lịch native — làm trong request luôn (Meta giữ lịch, không cần cron).
    if (toFb) {
      const r = await publishPagePost({ pageId, message, link, imageUrl, toFb: true, toIg: false, ...(schedMs ? { fbScheduleUnix: Math.round(schedMs / 1000) } : {}) }, token);
      fbPostId = r.fbPostId ?? "";
      warns.push(...r.warns);
    }

    // IG: đăng ngay trong request; hẹn giờ → xếp hàng cho cron tick.
    if (toIg) {
      if (schedMs) {
        try {
          await db.insert(schema.pagePostQueue).values({ adId, pageId, message, link, imageUrl, toFb: false, toIg: true, scheduledAt: new Date(schedMs) });
          igQueued = true;
        } catch { warns.push("Could not queue the Instagram post — run MIGRATION_v614 first."); }
      } else {
        const r = await publishPagePost({ pageId, message, link, imageUrl, toFb: false, toIg: true }, token);
        igMediaId = r.igMediaId ?? "";
        warns.push(...r.warns);
      }
    }

    return NextResponse.json({
      ok: true,
      ...(fbPostId ? { fbPostId, fbUrl: `https://www.facebook.com/${fbPostId}`, fbScheduled: !!schedMs } : {}),
      ...(igMediaId ? { igMediaId } : {}),
      ...(igQueued ? { igQueued: true, igAt: new Date(schedMs).toISOString() } : {}),
      ...(warns.length ? { warn: warns.join(" ") } : {}),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message) }, { status: 400 });
  }
}
