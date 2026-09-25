import { db, schema } from "@/lib/db";
import { and, eq, lte } from "drizzle-orm";

/**
 * v614 · Đăng bài lên Facebook Page + Instagram từ nội dung ad (nút → PAGE, Meta Ads Center).
 *  - FB Page: POST /{page}/feed (đăng ngay hoặc kèm scheduled_publish_time — đặt lịch NATIVE của Meta).
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
  /** FB only — unix seconds cho scheduled_publish_time (≥10 phút, ≤75 ngày). IG bỏ qua (queue lo). */
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
    const post = await fb(`${job.pageId}/feed`, pageToken, {
      ...(job.message ? { message: job.message } : {}),
      ...(job.link ? { link: job.link } : {}),
      // Đặt lịch native: bài nằm trong Scheduled posts của page, Meta tự đăng ĐÚNG giờ.
      ...(sched > 0 ? { published: false, scheduled_publish_time: sched } : {}),
    });
    fbPostId = String(post.id ?? "");
  }

  let igMediaId = "";
  if (job.toIg) {
    const ig = (pg.instagram_business_account ?? {}) as { id?: string };
    const igId = String(ig.id ?? "");
    if (!igId) warns.push("No Instagram Business account is linked to the Page — IG skipped (link it in Page settings → Linked accounts).");
    else if (!job.imageUrl) warns.push("This ad's creative has no usable image — Instagram needs one, IG skipped.");
    else {
      // Caption = message + link dạng text (IG không cho link click trong caption).
      const caption = [job.message, job.link].filter(Boolean).join("\n\n").slice(0, 2200);
      const cont = await fb(`${igId}/media`, pageToken, { image_url: job.imageUrl, caption });
      const cid = String(cont.id ?? "");
      if (!cid) warns.push("Instagram media container was not created — check instagram_content_publish permission.");
      else {
        const pub = await fb(`${igId}/media_publish`, pageToken, { creation_id: cid });
        igMediaId = String(pub.id ?? "");
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
  let ok = 0, failed = 0;
  for (const r of rows) {
    try {
      const res = await publishPagePost({ pageId: r.pageId, message: r.message, link: r.link, imageUrl: r.imageUrl, toFb: r.toFb, toIg: r.toIg }, token);
      await db.update(schema.pagePostQueue).set({ status: "done", result: res as never }).where(eq(schema.pagePostQueue.id, r.id));
      ok++;
    } catch (e) {
      await db.update(schema.pagePostQueue).set({ status: "error", result: { error: String((e as Error).message).slice(0, 300) } as never })
        .where(eq(schema.pagePostQueue.id, r.id)).catch(() => { /* giữ pending nếu cả update lỗi */ });
      failed++;
    }
  }
  return { processed: ok, failed };
}
