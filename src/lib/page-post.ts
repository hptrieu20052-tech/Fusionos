import { db, schema } from "@/lib/db";
import { and, eq, lte } from "drizzle-orm";

/**
 * v614 · Đăng bài lên Facebook Page + Instagram từ nội dung ad (nút → PAGE, Meta Ads Center).
 *  - FB Page (v617): PHOTO POST /{page}/photos — ảnh creative full + caption, LINK dán vào comment
 *    đầu tiên (comment chỉ thêm được khi bài đã publish → bài HẸN GIỜ đi qua page_post_queue,
 *    cron tick đăng ảnh + comment link khi tới giờ). Không có ảnh → fallback link post /feed.
 *  - Instagram: Content Publishing API (container /media → /media_publish) — cần IG Business account
 *    link với Page + quyền instagram_basic + instagram_content_publish. IG KHÔNG có đặt lịch native
 *    → bài hẹn giờ nằm trong bảng page_post_queue, cron tick gọi processPagePostQueue() đăng khi tới giờ.
 */
const V = "v23.0";
const G = `https://graph.facebook.com/${V}`;

async function fb(path: string, token: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${G}/${path}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, access_token: token }), signal: AbortSignal.timeout(45000) }
    : { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(String(j.error?.message ?? res.status).slice(0, 250));
  return j as Record<string, unknown>;
}

export type PagePostJob = {
  pageId: string;
  message: string;
  link: string;
  imageUrl: string;
  toFb: boolean;
  toIg: boolean;
  /** FB only — unix seconds cho scheduled_publish_time (≥10 phút, ≤75 ngày). v617: route không dùng
   *  nữa (hẹn giờ đi qua queue để còn comment link sau khi đăng) — giữ cho tương thích. */
  fbScheduleUnix?: number;
};

export type PagePostResult = { fbPostId?: string; igMediaId?: string; warns: string[] };

export async function publishPagePost(job: PagePostJob, sysToken: string): Promise<PagePostResult> {
  const warns: string[] = [];
  // Page token + IG account link — 1 call cho cả hai.
  const pg = await fb(`${job.pageId}?fields=access_token,instagram_business_account`, sysToken);
  const pageToken = String(pg.access_token ?? "");
  if (!pageToken) throw new Error("No Page access token — grant the system user the Page (pages_manage_posts) in Business Settings → System users.");

  let fbPostId = "";
  if (job.toFb) {
    const sched = Number(job.fbScheduleUnix ?? 0);
    if (job.imageUrl) {
      // v617 · PHOTO POST: đăng ảnh creative ĐẦY ĐỦ (link post cũ để FB cào ảnh OG rồi crop mất
      // headline). Link KHÔNG nằm caption — dán vào COMMENT đầu tiên ngay sau khi đăng.
      const post = await fb(`${job.pageId}/photos`, pageToken, {
        url: job.imageUrl,
        ...(job.message ? { message: job.message } : {}),
        ...(sched > 0 ? { published: false, scheduled_publish_time: sched } : {}),
      });
      // /photos trả {id: photoId, post_id: pageId_postId} — comment/URL dùng post_id.
      fbPostId = String((post as { post_id?: string }).post_id ?? post.id ?? "");
      if (job.link && fbPostId && !sched) {
        try { await fb(`${fbPostId}/comments`, pageToken, { message: job.link }); }
        catch { warns.push("Photo published but the link comment failed — paste the link in a comment manually."); }
      }
    } else {
      // Không có ảnh dùng được → giữ link post như cũ (FB tự dựng link card).
      const post = await fb(`${job.pageId}/feed`, pageToken, {
        ...(job.message ? { message: job.message } : {}),
        ...(job.link ? { link: job.link } : {}),
        ...(sched > 0 ? { published: false, scheduled_publish_time: sched } : {}),
      });
      fbPostId = String(post.id ?? "");
    }
  }

  let igMediaId = "";
  if (job.toIg) {
    const ig = (pg.instagram_business_account ?? {}) as { id?: string };
    const igId = String(ig.id ?? "");
    if (!igId) warns.push("No Instagram Business account is linked to the Page — IG skipped (link it in Page settings → Linked accounts).");
    else if (!job.imageUrl) warns.push("This ad's creative has no usable image — Instagram needs one, IG skipped.");
    else {
      // v618 · IG lỗi KHÔNG được ném ra ngoài: FB ở trên có thể ĐÃ đăng — throw ở đây làm caller
      // tưởng cả job fail rồi đăng lại FB lần nữa (nguồn bài trùng). IG lỗi → warn, job vẫn "xong".
      try {
        // Caption = message + link dạng text (IG không cho link click trong caption).
        const caption = [job.message, job.link].filter(Boolean).join("\n\n").slice(0, 2200);
        const cont = await fb(`${igId}/media`, pageToken, { image_url: job.imageUrl, caption });
        const cid = String(cont.id ?? "");
        if (!cid) warns.push("Instagram media container was not created — check instagram_content_publish permission.");
        else {
          const pub = await fb(`${igId}/media_publish`, pageToken, { creation_id: cid });
          igMediaId = String(pub.id ?? "");
        }
      } catch (e) {
        warns.push(`Instagram failed: ${String((e as Error).message).slice(0, 200)}`);
      }
    }
  }
  return { ...(fbPostId ? { fbPostId } : {}), ...(igMediaId ? { igMediaId } : {}), warns };
}

/** Cron tick: đăng các bài IG (và FB nếu có) đã tới giờ trong page_post_queue. */
export async function processPagePostQueue(): Promise<{ processed: number; failed: number }> {
  const token = process.env.META_SYSTEM_TOKEN ?? "";
  if (!token) return { processed: 0, failed: 0 };
  let rows: (typeof schema.pagePostQueue.$inferSelect)[] = [];
  try {
    rows = await db.select().from(schema.pagePostQueue)
      .where(and(eq(schema.pagePostQueue.status, "pending"), lte(schema.pagePostQueue.scheduledAt, new Date())))
      .limit(10);
  } catch { return { processed: 0, failed: 0 }; /* bảng chưa migrate */ }
  // v618 · Row kẹt "processing" quá 20' (tick chết giữa chừng — bài CÓ THỂ đã lên) → đóng error,
  // TUYỆT ĐỐI không đăng lại (đây từng là nguồn đăng trùng 2 bài FB).
  try {
    const stuck = await db.select().from(schema.pagePostQueue).where(eq(schema.pagePostQueue.status, "processing")).limit(20);
    for (const s of stuck) {
      const at = new Date(String((s.result as { claimedAt?: string } | null)?.claimedAt ?? s.createdAt)).getTime();
      if (Number.isFinite(at) && Date.now() - at > 20 * 60000) {
        await db.update(schema.pagePostQueue)
          .set({ status: "error", result: { error: "interrupted mid-publish — the post may already be live on the Page; check before re-queueing" } as never })
          .where(eq(schema.pagePostQueue.id, s.id)).catch(() => { /* thôi */ });
      }
    }
  } catch { /* thôi */ }
  let ok = 0, failed = 0;
  for (const r of rows) {
    // v618 · CLAIM nguyên tử: 2 tick chạy chồng nhau (hoặc tick trước timeout chưa kịp ghi done)
    // từng cùng nhặt 1 row pending → ĐĂNG TRÙNG. Chỉ tick chuyển được pending→processing mới đăng.
    const claimed = await db.update(schema.pagePostQueue)
      .set({ status: "processing", result: { claimedAt: new Date().toISOString() } as never })
      .where(and(eq(schema.pagePostQueue.id, r.id), eq(schema.pagePostQueue.status, "pending")))
      .returning({ id: schema.pagePostQueue.id })
      .catch(() => [] as { id: string }[]);
    if (!claimed.length) continue;
    try {
      const res = await publishPagePost({ pageId: r.pageId, message: r.message, link: r.link, imageUrl: r.imageUrl, toFb: r.toFb, toIg: r.toIg }, token);
      await db.update(schema.pagePostQueue).set({ status: "done", result: res as never }).where(eq(schema.pagePostQueue.id, r.id));
      ok++;
    } catch (e) {
      // Lỗi thật (trước khi đăng được gì — lỗi IG đã thành warn bên trong) → error, không retry.
      await db.update(schema.pagePostQueue).set({ status: "error", result: { error: String((e as Error).message).slice(0, 300) } as never })
        .where(eq(schema.pagePostQueue.id, r.id)).catch(() => { /* stale-recovery sẽ đóng row */ });
      failed++;
    }
  }
  return { processed: ok, failed };
}
