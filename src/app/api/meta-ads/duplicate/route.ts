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

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const token = process.env.META_SYSTEM_TOKEN ?? "";
  if (!token) return NextResponse.json({ ok: false, error: "Meta API not configured" }, { status: 400 });

  const b = await req.json().catch(() => null) as { kind?: string; id?: string; campaignId?: string; adsetId?: string; name?: string; budget?: number; deep?: boolean; startTime?: string } | null;
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
      // v535 · deep=false → copy khung KHÔNG kèm ads; mặc định (deep khác false) giữ hành vi cũ: kèm ads.
      const deep = b?.deep !== false;
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
      if (Object.keys(patch).length) await fb(newId, token, patch).catch((e: Error) => { patchWarn = `Copied, nhưng đổi tên/budget/lịch lỗi: ${String(e.message).slice(0, 120)} — sửa tay trong Ads Manager.`; });
      return NextResponse.json({ ok: true, id: newId, ...(patchWarn ? { warn: patchWarn } : {}) });
    }
    // kind === "ad"
    const adsetId = String(b?.adsetId ?? "").replace(/\D/g, "");
    const r = await fb(`${id}/copies`, token, {
      status_option: "PAUSED",
      ...(adsetId ? { adset_id: adsetId } : {}),
    });
    const newId = String(r.copied_ad_id ?? "");
    if (newId && name) await fb(newId, token, { name }).catch(() => { /* ignore */ });
    return NextResponse.json({ ok: true, id: newId || null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message) }, { status: 400 });
  }
}
