import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * v525 · Nhân bản ad set / ad ngay từ Meta Ads Center (Meta /copies API) — phục vụ playbook
 * MAIN/TEST: thăng cấp winner (dup ad set sang campaign MAIN), nhân biến thể (dup ad vào ad set).
 * v535 · Thêm kind "campaign" + cờ deep cho adset — luồng Dup chuẩn FUSION: copy KHUNG
 * (campaign/ad set, không kèm ads) rồi client chuyển sang Manage Products chọn sản phẩm và push.
 *
 * POST { kind: "campaign", id, name? }
 *   → copy campaign (KHÔNG kèm ad sets/ads, PAUSED); đổi tên nếu truyền. Trả id campaign mới.
 * POST { kind: "adset", id, campaignId?, name?, budget?, deep?, startTime? }
 *   → copy ad set vào campaignId (trống = cùng campaign), PAUSED. deep=false: KHÔNG kèm ads
 *     (copy khung — client dẫn sang kit chọn product); deep khác false: KÈM toàn bộ ads (mặc định cũ).
 *     startTime (ISO): đặt lịch chạy cho BẢN SAO — trống = giữ theo ad set gốc (giờ gốc đã qua thì bật là chạy ngay).
 * POST { kind: "ad", id, adsetId?, name? }
 *   → copy 1 ad (PAUSED) vào adsetId (trống = cùng ad set).
 */
const V = "v23.0";
const G = `https://graph.facebook.com/${V}`;

async function fb(path: string, token: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${G}/${path}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, access_token: token }), signal: AbortSignal.timeout(60000) }
    : { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) {
    const e = j.error ?? {};
    throw new Error(`${e.message ?? res.status}${e.error_user_msg ? " — " + e.error_user_msg : ""}`.slice(0, 300));
  }
  return j as Record<string, unknown>;
}

/**
 * v582 · COPY AD GIỮ NGUYÊN POST. Phát hiện 23/9 (2 post trùng nội dung trên page): /copies của
 * Meta TẠO LẠI creative với ad inline (object_story_spec) → Facebook sinh POST MỚI, mất social proof.
 * Cách chuẩn "giữ post ID": tạo creative mới trỏ THẲNG object_story_id = post của ad gốc rồi dựng ad
 * từ creative đó — like/comment/share theo 100%. Không lấy được post id → fallback /copies như cũ
 * (kept=false, UI cảnh báo).
 */
async function copyAdKeepPost(token: string, act: string, aid: string, adsetId: string, name?: string): Promise<{ id: string; kept: boolean }> {
  let post = "", ig = "", srcName = "", srcAdset = "";
  try {
    const src = await fb(`${aid}?fields=name,adset_id,creative{effective_object_story_id,instagram_actor_id}`, token);
    srcName = String(src.name ?? "");
    srcAdset = String(src.adset_id ?? "");
    const cr = (src.creative ?? {}) as { effective_object_story_id?: string; instagram_actor_id?: string };
    post = String(cr.effective_object_story_id ?? "");
    ig = String(cr.instagram_actor_id ?? "");
  } catch { /* đọc không được → fallback /copies */ }
  const target = adsetId || srcAdset;
  if (post && act && target) {
    try {
      // v591 · creative bản sao kèm: UTM động (đơn về FUSION khớp campaign/ad) + tắt multi-advertiser
      // + tắt Advantage+ enhancements (khỏi bị Meta crop/chế ảnh). Meta từ chối field nào → thử bậc
      // thấp hơn (instagram_actor_id giữ placement IG của post gốc, cũng có thể bị từ chối).
      const URL_TAGS = "utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.name}}&utm_content={{ad.name}}";
      const igx = ig ? { instagram_actor_id: ig } : {};
      const tries: Record<string, unknown>[] = [
        { object_story_id: post, ...igx, url_tags: URL_TAGS, contextual_multi_ads: { enroll_status: "OPT_OUT" }, degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: "OPT_OUT" } } } },
        { object_story_id: post, ...igx, url_tags: URL_TAGS, contextual_multi_ads: { enroll_status: "OPT_OUT" } },
        { object_story_id: post, ...igx, url_tags: URL_TAGS },
        { object_story_id: post, ...igx },
        { object_story_id: post },
      ];
      let nc: Record<string, unknown> | null = null;
      for (const t of tries) {
        try { nc = await fb(`${act}/adcreatives`, token, t); break; } catch { /* thử bậc thấp hơn */ }
      }
      if (nc?.id) {
        const ad = await fb(`${act}/ads`, token, { name: (name ?? "").trim() || srcName || `Ad ${aid} - Copy`, adset_id: target, creative: { creative_id: String(nc.id) }, status: "PAUSED" });
        if (ad.id) return { id: String(ad.id), kept: true };
      }
    } catch { /* rơi xuống /copies */ }
  }
  const r = await fb(`${aid}/copies`, token, { status_option: "PAUSED", ...(adsetId ? { adset_id: adsetId } : {}) });
  return { id: String(r.copied_ad_id ?? ""), kept: false };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const token = process.env.META_SYSTEM_TOKEN ?? "";
  if (!token) return NextResponse.json({ ok: false, error: "Meta API not configured" }, { status: 400 });
  const acctRaw = process.env.META_AD_ACCOUNT_ID ?? "";
  const act = acctRaw ? (acctRaw.startsWith("act_") ? acctRaw : `act_${acctRaw}`) : "";

  const b = await req.json().catch(() => null) as { kind?: string; id?: string; campaignId?: string; adsetId?: string; name?: string; budget?: number; deep?: boolean; startTime?: string; adIds?: unknown[] } | null;
  const kind = b?.kind === "ad" ? "ad" : b?.kind === "adset" ? "adset" : b?.kind === "campaign" ? "campaign" : "";
  const id = String(b?.id ?? "").replace(/\D/g, "");
  if (!kind || !id) return NextResponse.json({ ok: false, error: "kind (campaign|adset|ad) + id required" }, { status: 400 });
  const name = String(b?.name ?? "").trim().slice(0, 120);

  try {
    if (kind === "campaign") {
      // v535 · copy KHUNG campaign (objective/cấu hình), không kèm ad sets/ads — client dẫn sang kit chọn product.
      const r = await fb(`${id}/copies`, token, { deep_copy: false, status_option: "PAUSED" });
      const newId = String(r.copied_campaign_id ?? (Array.isArray(r.ad_object_ids) ? (r.ad_object_ids as { copied_id?: string }[])[0]?.copied_id : "") ?? "");
      if (!newId) return NextResponse.json({ ok: true, id: null, warn: "Copied, but Meta didn't return the new campaign id — check Ads Manager." });
      if (name) await fb(newId, token, { name }).catch(() => { /* copy đã xong — đổi tên lỗi thì sửa tay */ });
      return NextResponse.json({ ok: true, id: newId });
    }
    if (kind === "adset") {
      const campaignId = String(b?.campaignId ?? "").replace(/\D/g, "");
      // v551 · adIds: CHỈ copy những ad được chọn — copy khung trước rồi copy từng ad vào bản sao.
      const adIds = (Array.isArray(b?.adIds) ? b!.adIds! : []).map((x) => String(x).replace(/\D/g, "")).filter(Boolean).slice(0, 50);
      // v535 · deep=false → copy khung KHÔNG kèm ads; mặc định (deep khác false) giữ hành vi cũ: kèm ads.
      const deep = adIds.length ? false : b?.deep !== false;
      const r = await fb(`${id}/copies`, token, {
        deep_copy: deep, status_option: "PAUSED",
        ...(campaignId ? { campaign_id: campaignId } : {}),
      });
      const newId = String(r.copied_adset_id ?? (Array.isArray(r.ad_object_ids) ? (r.ad_object_ids as { copied_id?: string }[])[0]?.copied_id : "") ?? "");
      if (!newId) return NextResponse.json({ ok: true, id: null, warn: "Copied, but Meta didn't return the new ad set id — check Ads Manager." });
      const budget = Number(b?.budget);
      const patch: Record<string, unknown> = {};
      if (name) patch.name = name;
      if (budget > 0) patch.daily_budget = Math.round(Math.min(1000, budget) * 100);
      // v536 · lịch chạy riêng cho bản sao (ISO, tương lai) — không truyền = giữ start_time của gốc.
      const st = String(b?.startTime ?? "").trim();
      if (st) {
        const d = new Date(st);
        if (!isNaN(d.getTime()) && d.getTime() > Date.now()) patch.start_time = d.toISOString();
      }
      let patchWarn = "";
      if (Object.keys(patch).length) await fb(newId, token, patch).catch((e: Error) => { patchWarn = `Copied, but rename/budget/schedule update failed: ${String(e.message).slice(0, 120)} — fix manually in Ads Manager.`; });
      // v551 · copy TỪNG ad được chọn vào bản sao — PAUSED hết.
      // v582 · giữ post THẬT: creative mới trỏ object_story_id của ad gốc (xem copyAdKeepPost).
      let copied = 0, kept = 0;
      const adFails: string[] = [];
      for (const aid of adIds) {
        try { const c = await copyAdKeepPost(token, act, aid, newId); copied++; if (c.kept) kept++; }
        catch (e) { adFails.push(String((e as Error).message).slice(0, 80)); }
      }
      const warns = [
        patchWarn,
        adFails.length ? `${adFails.length} ad(s) failed to copy: ${adFails[0]}` : "",
        copied > kept ? `${copied - kept} ad(s) got a NEW post (original post not reusable) — their social proof did NOT carry over` : "",
      ].filter(Boolean).join("; ");
      return NextResponse.json({ ok: true, id: newId, ...(adIds.length ? { copied, keptPosts: kept } : {}), ...(warns ? { warn: warns } : {}) });
    }
    // kind === "ad" — v582 · giữ post thật qua object_story_id (fallback /copies nếu không lấy được post)
    const adsetId = String(b?.adsetId ?? "").replace(/\D/g, "");
    const c = await copyAdKeepPost(token, act, id, adsetId, name || undefined);
    if (c.id && name && !c.kept) await fb(c.id, token, { name }).catch(() => { /* ignore */ });
    return NextResponse.json({ ok: true, id: c.id || null, keptPost: c.kept });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message) }, { status: 400 });
  }
}
