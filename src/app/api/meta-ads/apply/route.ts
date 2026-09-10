import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * v450 · POST /api/meta-ads/apply — THỰC THI 1 đề xuất của AI sau khi admin bấm Approve.
 * Body: { action: "pause"|"raise_budget"|"lower_budget", adId, adsetId }
 *  - pause         → set ad status PAUSED (chỉ đúng 1 ad, không đụng ad set).
 *  - raise_budget  → daily_budget của AD SET × 1.2 (đúng guardrail +20%/lần).
 *  - lower_budget  → daily_budget × 0.8 (sàn $1).
 * Mỗi request = 1 hành động = 1 cú Approve. Không bao giờ tự chạy — chỉ chạy khi admin bấm.
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
  if (!token) return NextResponse.json({ ok: false, error: "META_SYSTEM_TOKEN missing" }, { status: 400 });

  const body = await req.json().catch(() => null) as { action?: string; adId?: string; adsetId?: string; id?: string; status?: string; budget?: number } | null;
  const action = body?.action ?? "";
  const adId = String(body?.adId ?? "").replace(/\D/g, "");
  const adsetId = String(body?.adsetId ?? "").replace(/\D/g, "");

  try {
    // v457 · điều khiển trực tiếp từ Ads Center (không qua AI): bật/tắt campaign|adset|ad + set budget.
    if (action === "set_status") {
      const id = String(body?.id ?? "").replace(/\D/g, "");
      const status = body?.status === "ACTIVE" ? "ACTIVE" : "PAUSED";
      if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
      await fb(id, token, { status });
      return NextResponse.json({ ok: true, did: status });
    }
    if (action === "set_budget") {
      const dollars = Number(body?.budget);
      if (!adsetId) return NextResponse.json({ ok: false, error: "adsetId required" }, { status: 400 });
      if (!isFinite(dollars) || dollars <= 0) return NextResponse.json({ ok: false, error: "budget must be > 0" }, { status: 400 });
      const cents = Math.max(100, Math.round(dollars * 100));
      await fb(adsetId, token, { daily_budget: cents });
      return NextResponse.json({ ok: true, did: `$${(cents / 100).toFixed(2)}/day` });
    }
    if (action === "pause") {
      if (!adId) return NextResponse.json({ ok: false, error: "adId required" }, { status: 400 });
      await fb(adId, token, { status: "PAUSED" });
      return NextResponse.json({ ok: true, did: `Ad ${adId} paused` });
    }
    if (action === "raise_budget" || action === "lower_budget") {
      if (!adsetId) return NextResponse.json({ ok: false, error: "adsetId required" }, { status: 400 });
      const cur = await fb(`${adsetId}?fields=daily_budget,name`, token);
      const curCents = Number(cur.daily_budget) || 0;
      if (!curCents) return NextResponse.json({ ok: false, error: "ad set has no daily budget (CBO?)" }, { status: 400 });
      const next = Math.max(100, Math.round(curCents * (action === "raise_budget" ? 1.2 : 0.8)));
      await fb(adsetId, token, { daily_budget: next });
      return NextResponse.json({ ok: true, did: `${cur.name}: $${(curCents / 100).toFixed(2)} → $${(next / 100).toFixed(2)}/day` });
    }
    return NextResponse.json({ ok: false, error: "action must be pause | raise_budget | lower_budget" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message) }, { status: 400 });
  }
}
