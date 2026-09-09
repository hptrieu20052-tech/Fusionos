import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * v449 · GET|POST /api/cron/meta-insights — đồng bộ NỀN số liệu Meta ads vào bảng meta_insights.
 * Gọi định kỳ 1–3 giờ/lần (cùng chỗ đang gọi /api/cron/tiktok-finance).
 *
 * Kéo insights level=AD, theo NGÀY (time_increment=1), cửa sổ 28 ngày gần nhất → upsert theo
 * (day, ad_id). Ngày cũ đã chốt không đổi; hôm nay/hôm qua được cập nhật dần mỗi vòng.
 * Actions: ATC + Purchase + revenue đọc từ mảng actions/action_values (ưu tiên omni_*).
 *
 * Xác thực: Bearer CRON_SECRET | ?key=CRON_SECRET | header x-vercel-cron | session admin.
 * Env: META_SYSTEM_TOKEN + META_AD_ACCOUNT_ID (đã có từ v445).
 */
const V = "v23.0";
const G = `https://graph.facebook.com/${V}`;

type Action = { action_type: string; value: string };
type Row = {
  date_start: string; campaign_id: string; campaign_name?: string; adset_id: string; adset_name?: string;
  ad_id: string; ad_name?: string; spend?: string; impressions?: string; clicks?: string;
  actions?: Action[]; action_values?: Action[];
};

const pick = (arr: Action[] | undefined, keys: string[]): number => {
  for (const k of keys) { const f = (arr ?? []).find((a) => a.action_type === k); if (f) return Number(f.value) || 0; }
  return 0;
};

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const key = req.nextUrl.searchParams.get("key") ?? "";
  let ok = !!req.headers.get("x-vercel-cron") || (!!secret && (auth === `Bearer ${secret}` || key === secret));
  if (!ok) { const s = await getSession(); ok = !!s && s.role === "admin"; }
  if (!ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const token = process.env.META_SYSTEM_TOKEN ?? "";
  const acctRaw = process.env.META_AD_ACCOUNT_ID ?? "";
  if (!token || !acctRaw) return NextResponse.json({ ok: false, error: "META_SYSTEM_TOKEN / META_AD_ACCOUNT_ID missing" }, { status: 400 });
  const act = acctRaw.startsWith("act_") ? acctRaw : `act_${acctRaw}`;

  const started = Date.now();
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
  const fields = "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,actions,action_values";
  let url = `${G}/${act}/insights?level=ad&time_increment=1&fields=${fields}&limit=300&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`;

  let upserts = 0;
  for (let page = 0; page < 20 && url; page++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) return NextResponse.json({ ok: false, error: String(j.error?.message ?? res.status).slice(0, 250), upserts }, { status: 400 });
    const rows = (j.data ?? []) as Row[];
    const values = rows.filter((r) => r.ad_id && r.date_start).map((r) => ({
      day: r.date_start,
      campaignId: r.campaign_id, campaignName: r.campaign_name ?? "",
      adsetId: r.adset_id, adsetName: r.adset_name ?? "",
      adId: r.ad_id, adName: r.ad_name ?? "",
      spend: (Number(r.spend) || 0).toFixed(2),
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      linkClicks: pick(r.actions, ["link_click"]),
      atc: pick(r.actions, ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"]),
      purchases: pick(r.actions, ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
      revenue: pick(r.action_values, ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]).toFixed(2),
      updatedAt: new Date(),
    }));
    if (values.length) {
      await db.insert(schema.metaInsights).values(values).onConflictDoUpdate({
        target: [schema.metaInsights.day, schema.metaInsights.adId],
        set: {
          campaignName: sql`excluded.campaign_name`, adsetName: sql`excluded.adset_name`, adName: sql`excluded.ad_name`,
          spend: sql`excluded.spend`, impressions: sql`excluded.impressions`, clicks: sql`excluded.clicks`,
          linkClicks: sql`excluded.link_clicks`, atc: sql`excluded.atc`, purchases: sql`excluded.purchases`,
          revenue: sql`excluded.revenue`, updatedAt: sql`now()`,
        },
      });
      upserts += values.length;
    }
    url = j.paging?.next ?? "";
    if (Date.now() - started > 100000) break;   // ngân sách thời gian
  }
  return NextResponse.json({ ok: true, upserts, since, until, tookMs: Date.now() - started });
}
