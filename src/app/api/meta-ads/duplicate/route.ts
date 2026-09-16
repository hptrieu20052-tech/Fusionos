import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * v525 · Nhân bản ad set / ad ngay từ Meta Ads Center (Meta /copies API) — phục vụ playbook
 * MAIN/TEST: thăng cấp winner (dup ad set sang campaign MAIN), nhân biến thể (dup ad vào ad set).
 *
 * POST { kind: "adset", id, campaignId?, name?, budget? }
 *   → copy ad set (KÈM ads bên trong, tất cả PAUSED) vào campaignId (trống = cùng campaign);
 *     đổi tên + đặt daily budget mới nếu truyền.
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

  const b = await req.json().catch(() => null) as { kind?: string; id?: string; campaignId?: string; adsetId?: string; name?: string; budget?: number } | null;
  const kind = b?.kind === "ad" ? "ad" : b?.kind === "adset" ? "adset" : "";
  const id = String(b?.id ?? "").replace(/\D/g, "");
  if (!kind || !id) return NextResponse.json({ ok: false, error: "kind (adset|ad) + id required" }, { status: 400 });
  const name = String(b?.name ?? "").trim().slice(0, 120);

  try {
    if (kind === "adset") {
      const campaignId = String(b?.campaignId ?? "").replace(/\D/g, "");
      // deep_copy: copy cả ads bên trong; status_option PAUSED — duyệt xong bật tay.
      const r = await fb(`${id}/copies`, token, {
        deep_copy: true, status_option: "PAUSED",
        ...(campaignId ? { campaign_id: campaignId } : {}),
      });
      const newId = String(r.copied_adset_id ?? (Array.isArray(r.ad_object_ids) ? (r.ad_object_ids as { copied_id?: string }[])[0]?.copied_id : "") ?? "");
      if (!newId) return NextResponse.json({ ok: true, id: null, warn: "Copied, but Meta didn't return the new ad set id — check Ads Manager." });
      const budget = Number(b?.budget);
      const patch: Record<string, unknown> = {};
      if (name) patch.name = name;
      if (budget > 0) patch.daily_budget = Math.round(Math.min(1000, budget) * 100);
      if (Object.keys(patch).length) await fb(newId, token, patch).catch(() => { /* copy đã xong — đổi tên/budget lỗi thì sửa tay */ });
      return NextResponse.json({ ok: true, id: newId });
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
