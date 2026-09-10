import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * v457 · GET /api/meta-ads/entities — trạng thái CẤU HÌNH (status) + daily budget THẬT từ Meta,
 * cho toggle bật/tắt và ô sửa budget ở Ads Center. Đọc trực tiếp Graph API (không cache DB —
 * đây là dữ liệu điều khiển, phải là số thật tại thời điểm bấm).
 * Trả: { camp: {id: status}, adsets: {id: {status, budget(USD)}}, ads: {id: {status, thumb, img}} }
 * v462 · ads kèm THUMBNAIL creative (thumb 512px để zoom xem mẫu nào; img = ảnh gốc nếu là ảnh tĩnh).
 */
const V = "v23.0";
const G = `https://graph.facebook.com/${V}`;

async function fbList(url: string, token: string, maxPages = 5): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let next = url;
  for (let p = 0; p < maxPages && next; p++) {
    const res = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(String(j.error?.message ?? res.status).slice(0, 250));
    out.push(...((j.data ?? []) as Record<string, unknown>[]));
    next = j.paging?.next ?? "";
  }
  return out;
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const token = process.env.META_SYSTEM_TOKEN ?? "";
  const acctRaw = process.env.META_AD_ACCOUNT_ID ?? "";
  if (!token || !acctRaw) return NextResponse.json({ ok: false, error: "META_SYSTEM_TOKEN / META_AD_ACCOUNT_ID missing" }, { status: 400 });
  const act = acctRaw.startsWith("act_") ? acctRaw : `act_${acctRaw}`;

  try {
    const [camps, adsets, ads] = await Promise.all([
      fbList(`${G}/${act}/campaigns?fields=id,status&limit=200`, token),
      fbList(`${G}/${act}/adsets?fields=id,status,effective_status,daily_budget&limit=200`, token),
      fbList(`${G}/${act}/ads?fields=id,status,effective_status,creative.thumbnail_width(512).thumbnail_height(512){thumbnail_url,image_url}&limit=300`, token),
    ]);
    return NextResponse.json({
      ok: true,
      camp: Object.fromEntries(camps.map((c) => [String(c.id), String(c.status ?? "")])),
      adsets: Object.fromEntries(adsets.map((s) => [String(s.id), { status: String(s.status ?? ""), eff: String(s.effective_status ?? ""), budget: (Number(s.daily_budget) || 0) / 100 }])),
      ads: Object.fromEntries(ads.map((a) => {
        const cr = (a.creative ?? {}) as { thumbnail_url?: string; image_url?: string };
        // eff = trạng thái HIỆU LỰC (ADSET_PAUSED/CAMPAIGN_PAUSED khi tầng cha tắt) — UI dựng nhãn "tắt theo set".
        return [String(a.id), { status: String(a.status ?? ""), eff: String(a.effective_status ?? ""), thumb: cr.thumbnail_url ?? null, img: cr.image_url ?? cr.thumbnail_url ?? null }];
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message) }, { status: 400 });
  }
}
