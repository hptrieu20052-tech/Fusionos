import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * v587 · POST /api/meta-ads/publish-post { adId } — đăng NỘI DUNG của ad thành BÀI CÔNG KHAI trên page.
 * Meta KHÔNG cho publish ngược dark post (post sinh từ ad) lên tường — nên làm chiều xuôi:
 * lấy caption + link sản phẩm từ creative của ad → POST /{page}/feed (page access token) → bài organic
 * thật trên page (Facebook tự kéo ảnh OG từ trang sản phẩm). Sau đó muốn gom tương tác về 1 chỗ thì
 * chạy ads mới bằng CHÍNH post này (dup giữ post — v582).
 * Cần token có quyền quản lý page (pages_manage_posts); thiếu quyền → báo rõ, không đăng gì.
 */
const V = "v23.0";
const G = `https://graph.facebook.com/${V}`;

async function fb(path: string, token: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${G}/${path}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, access_token: token }), signal: AbortSignal.timeout(30000) }
    : { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(String(j.error?.message ?? res.status).slice(0, 250));
  return j as Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const token = process.env.META_SYSTEM_TOKEN ?? "";
  if (!token) return NextResponse.json({ ok: false, error: "Meta API not configured" }, { status: 400 });
  const b = await req.json().catch(() => null) as { adId?: string } | null;
  const adId = String(b?.adId ?? "").replace(/\D/g, "");
  if (!adId) return NextResponse.json({ ok: false, error: "adId required" }, { status: 400 });

  try {
    type Spec = { page_id?: string; link_data?: { message?: string; link?: string; name?: string }; video_data?: { message?: string; call_to_action?: { value?: { link?: string } } } };
    const ad = await fb(`${adId}?fields=name,creative{object_story_spec,effective_object_story_id}`, token);
    const cr = (ad.creative ?? {}) as { object_story_spec?: Spec; effective_object_story_id?: string };
    const spec = cr.object_story_spec ?? {};
    const pageId = String(spec.page_id ?? (cr.effective_object_story_id ?? "").split("_")[0] ?? "");
    const message = String(spec.link_data?.message ?? spec.video_data?.message ?? "").trim();
    const link = String(spec.link_data?.link ?? spec.video_data?.call_to_action?.value?.link ?? "").trim();
    if (!pageId) return NextResponse.json({ ok: false, error: "Cannot resolve the Facebook Page from this ad's creative." }, { status: 400 });
    if (!message && !link) return NextResponse.json({ ok: false, error: "This ad's creative has no caption/link to publish." }, { status: 400 });

    // Page access token — cần system token có vai trò trên page + pages_manage_posts.
    let pageToken = "";
    try {
      const pg = await fb(`${pageId}?fields=access_token`, token);
      pageToken = String(pg.access_token ?? "");
    } catch { /* xử lý chung bên dưới */ }
    if (!pageToken) {
      return NextResponse.json({ ok: false, error: "No Page access token — the system token lacks a role on the Page or the pages_manage_posts permission. Grant it in Business Settings → System users → Assign the Page, then retry." }, { status: 400 });
    }

    const post = await fb(`${pageId}/feed`, pageToken, { ...(message ? { message } : {}), ...(link ? { link } : {}) });
    const postId = String(post.id ?? "");
    return NextResponse.json({ ok: true, postId, url: postId ? `https://www.facebook.com/${postId}` : null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message) }, { status: 400 });
  }
}
