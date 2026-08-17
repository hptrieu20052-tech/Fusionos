/**
 * v273 · Đăng Reel lên Meta (Instagram + Facebook Page) qua Graph API.
 *
 * Cần 3 env (lấy SAU khi Business Verification + App Review / token dev — xem hướng dẫn kèm zip):
 *   META_ACCESS_TOKEN  — Page access token (long-lived) của Page Talewix (IG Business đã nối Page này)
 *   META_IG_USER_ID    — Instagram Business user id (số, không phải @username)
 *   META_PAGE_ID       — Facebook Page id
 * Thiếu env → route trả lỗi rõ ràng, KHÔNG crash. Nút trong UI vẫn hiện để test độ sẵn sàng.
 *
 * IG (2 bước):  POST /{ig}/media (REELS + video_url R2) → poll status → /{ig}/media_publish.
 * FB (3 bước):  /{page}/video_reels start → rupload (file_url R2, Meta tự tải) → finish PUBLISHED.
 * Video phải là URL công khai tải được (R2 publicUrl của mình đạt), 9:16 là chuẩn Reel.
 */

const V = "v21.0";
const G = `https://graph.facebook.com/${V}`;

export type MetaCfg = { token: string; igUserId: string; pageId: string };

export function metaCfg(): MetaCfg | null {
  const token = process.env.META_ACCESS_TOKEN ?? "";
  const igUserId = process.env.META_IG_USER_ID ?? "";
  const pageId = process.env.META_PAGE_ID ?? "";
  if (!token || !igUserId || !pageId) return null;
  return { token, igUserId, pageId };
}

type J = Record<string, unknown>;
const jf = async (url: string, init?: RequestInit): Promise<J> => {
  const r = await fetch(url, init);
  const j = (await r.json().catch(() => ({}))) as J;
  if (!r.ok) {
    const err = (j as { error?: { message?: string } }).error;
    throw new Error(err?.message ?? `Meta API HTTP ${r.status}`);
  }
  return j;
};

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Đăng Instagram Reel. Trả về permalink (link bài) nếu lấy được. */
export async function igPublishReel(cfg: MetaCfg, videoUrl: string, caption: string): Promise<{ mediaId: string; permalink: string | null }> {
  // 1 · tạo container
  const c = await jf(`${G}/${cfg.igUserId}/media`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: "REELS", video_url: videoUrl, caption, access_token: cfg.token }),
  });
  const containerId = String(c.id ?? "");
  if (!containerId) throw new Error("IG: no container id returned");

  // 2 · chờ Meta tải + xử lý video (poll tối đa ~4 phút)
  let status = "";
  for (let i = 0; i < 48; i++) {
    await sleep(5000);
    const s = await jf(`${G}/${containerId}?fields=status_code&access_token=${encodeURIComponent(cfg.token)}`);
    status = String(s.status_code ?? "");
    if (status === "FINISHED") break;
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`IG container ${status} — check video format (MP4 9:16, ≤100MB, public URL)`);
  }
  if (status !== "FINISHED") throw new Error("IG: video still processing after 4 minutes — try again shortly");

  // 3 · publish
  const p = await jf(`${G}/${cfg.igUserId}/media_publish`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerId, access_token: cfg.token }),
  });
  const mediaId = String(p.id ?? "");
  let permalink: string | null = null;
  try {
    const m = await jf(`${G}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(cfg.token)}`);
    permalink = typeof m.permalink === "string" ? m.permalink : null;
  } catch { /* permalink là phụ, thiếu không sao */ }
  return { mediaId, permalink };
}

/** Đăng Facebook Page Reel (remote upload — Meta tự tải file từ R2). Trả về link reel. */
export async function fbPublishReel(cfg: MetaCfg, videoUrl: string, description: string): Promise<{ videoId: string; url: string }> {
  // 1 · start
  const st = await jf(`${G}/${cfg.pageId}/video_reels`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upload_phase: "start", access_token: cfg.token }),
  });
  const videoId = String(st.video_id ?? "");
  if (!videoId) throw new Error("FB: no video_id returned");

  // 2 · upload theo kiểu file_url (hosted file — không phải đẩy bytes qua Vercel)
  const up = await fetch(`https://rupload.facebook.com/video-upload/${V}/${videoId}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${cfg.token}`, file_url: videoUrl },
  });
  if (!up.ok) {
    const j = (await up.json().catch(() => ({}))) as { debug_info?: { message?: string } };
    throw new Error(j.debug_info?.message ?? `FB upload HTTP ${up.status}`);
  }

  // 3 · finish + publish
  await jf(`${G}/${cfg.pageId}/video_reels?upload_phase=finish&video_id=${videoId}&video_state=PUBLISHED&description=${encodeURIComponent(description)}&access_token=${encodeURIComponent(cfg.token)}`, { method: "POST" });
  return { videoId, url: `https://www.facebook.com/reel/${videoId}` };
}
