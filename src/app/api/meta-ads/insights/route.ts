import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, gte, lte, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { orChatJSON } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * v449 · Meta Ads Center (admin).
 * GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD → dòng insights theo ngày x ad (đọc DB, không gọi Meta).
 * POST { from, to }                   → AI phân tích: code tính tín hiệu, model viết nhận định
 *                                       + đề xuất hành động từng ad (orChatJSON, tiếng Việt).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const to = (sp.get("to") ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const from = (sp.get("from") ?? new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10)).slice(0, 10);
  const rows = await db.select().from(schema.metaInsights)
    .where(and(gte(schema.metaInsights.day, from), lte(schema.metaInsights.day, to)))
    .orderBy(schema.metaInsights.day);
  const [m] = await db.select({ t: sql<string>`max(updated_at)` }).from(schema.metaInsights);
  // v451 · map trạng thái campaign cho filter Active/Inactive (bảng có thể chưa migrate → rỗng êm).
  const statuses = await db.select().from(schema.metaCampaigns).catch(() => []);
  return NextResponse.json({ ok: true, rows, from, to, lastSyncAt: m?.t ?? null, campaignStatus: Object.fromEntries(statuses.map((c) => [c.campaignId, c.status ?? ""])) });
}

// ---- Tín hiệu tính bằng CODE (AI chỉ nhận định, không làm số học) ----
type Agg = {
  ad: string; adset: string; campaign: string; days: number;
  spend: number; impressions: number; linkClicks: number; atc: number; purchases: number; revenue: number;
  ctr: number; cpc: number; costAtc: number; cpa: number; roas: number;
  spend3: number; ctr3: number;            // 3 ngày gần nhất — bắt đà tụt (fatigue)
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({})) as { from?: string; to?: string; model?: string };
  const model = String(body.model ?? "").trim() || undefined;   // v450b · model chọn từ UI (trống = default server)
  const to = (body.to ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const from = (body.from ?? new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10)).slice(0, 10);
  const rows = await db.select().from(schema.metaInsights)
    .where(and(gte(schema.metaInsights.day, from), lte(schema.metaInsights.day, to)));
  if (!rows.length) return NextResponse.json({ ok: false, error: "No data in range — run the sync first" }, { status: 400 });

  const d3 = new Date(new Date(to + "T00:00:00Z").getTime() - 2 * 86400000).toISOString().slice(0, 10);
  const idByKey = new Map<string, { adId: string; adsetId: string; campId: string }>();
  const byAd = new Map<string, Agg & { _imp3: number; _lc3: number }>();
  for (const r of rows) {
    const k = r.adId;
    idByKey.set(k, { adId: r.adId, adsetId: r.adsetId, campId: r.campaignId });
    const a = byAd.get(k) ?? {
      ad: r.adName ?? r.adId, adset: r.adsetName ?? "", campaign: r.campaignName ?? "", days: 0,
      spend: 0, impressions: 0, linkClicks: 0, atc: 0, purchases: 0, revenue: 0,
      ctr: 0, cpc: 0, costAtc: 0, cpa: 0, roas: 0, spend3: 0, ctr3: 0, _imp3: 0, _lc3: 0,
    };
    a.days++; a.spend += Number(r.spend) || 0; a.impressions += r.impressions ?? 0;
    a.linkClicks += r.linkClicks ?? 0; a.atc += r.atc ?? 0; a.purchases += r.purchases ?? 0; a.revenue += Number(r.revenue) || 0;
    if (r.day >= d3) { a.spend3 += Number(r.spend) || 0; a._imp3 += r.impressions ?? 0; a._lc3 += r.linkClicks ?? 0; }
    byAd.set(k, a);
  }
  const aggs = Array.from(byAd.values()).map((a) => ({
    ...a,
    ctr: a.impressions ? +(100 * a.linkClicks / a.impressions).toFixed(2) : 0,
    cpc: a.linkClicks ? +(a.spend / a.linkClicks).toFixed(2) : 0,
    costAtc: a.atc ? +(a.spend / a.atc).toFixed(2) : 0,
    cpa: a.purchases ? +(a.spend / a.purchases).toFixed(2) : 0,
    roas: a.spend ? +(a.revenue / a.spend).toFixed(2) : 0,
    ctr3: a._imp3 ? +(100 * a._lc3 / a._imp3).toFixed(2) : 0,
  })).sort((x, y) => y.spend - x.spend);

  const idByName = new Map(Array.from(byAd.entries()).map(([id, a]) => [a.ad, idByKey.get(id)!]));
  // v452 · trạng thái campaign — AI không đề xuất pause/budget cho ad thuộc campaign đã TẮT.
  const campRows = await db.select().from(schema.metaCampaigns).catch(() => []);
  const campStatus = new Map(campRows.map((c) => [c.campaignId, c.status ?? ""]));
  const table = aggs.map((a) => ({
    campaign: a.campaign, adset: a.adset, ad: a.ad,
    campaignStatus: campStatus.get(idByName.get(a.ad)?.campId ?? "") || "UNKNOWN",
    adId: idByName.get(a.ad)?.adId ?? "", adsetId: idByName.get(a.ad)?.adsetId ?? "", days: a.days,
    spend: +a.spend.toFixed(2), impressions: a.impressions, linkClicks: a.linkClicks,
    ctrLinkPct: a.ctr, ctrLink3dPct: a.ctr3, cpcLink: a.cpc,
    atc: a.atc, costPerAtc: a.costAtc, purchases: a.purchases, cpa: a.cpa,
    revenue: +a.revenue.toFixed(2), roas: a.roas, spendLast3d: +a.spend3.toFixed(2),
  }));

  const system = [
    "Bạn là chuyên gia tối ưu Meta ads cho POD/e-commerce (AOV sản phẩm ~$25-45, sách cá nhân hoá trẻ em).",
    "Bạn nhận BẢNG SỐ ĐÃ TÍNH SẴN (không tự tính lại số học). Nguyên tắc:",
    "- Ad tiêu < $10 coi như chưa đủ dữ liệu — đừng kết luận mạnh.",
    "- CTR link tốt ≥ 1.5-2%; cost/ATC tốt < $8-10; CPA hoà vốn quanh $20-25; ROAS mục tiêu ≥ 1.5.",
    "- ctrLink3dPct tụt >30% so với ctrLinkPct = dấu hiệu creative fatigue.",
    "- Đề xuất phải THẬN TRỌNG: pause khi đủ bằng chứng (tiêu ≥ ~1 AOV mà 0 purchase và tín hiệu sớm xấu); tăng budget tối đa +20%/lần; đừng đụng ad đang có CPA tốt.",
    "- Ad có campaignStatus KHÁC ACTIVE = campaign đã tắt: chỉ dùng làm dữ liệu tham khảo, TUYỆT ĐỐI không đề xuất pause/raise/lower cho các ad này (đề xuất là thừa).",
    'Trả JSON đúng schema: {"summary": string (3-6 câu tiếng Việt, tổng quan), "winners": string[], "losers": string[], "actions": [{"ad": string, "adId": string (copy NGUYÊN VĂN từ bảng), "adsetId": string (copy NGUYÊN VĂN), "action": "keep"|"pause"|"raise_budget"|"lower_budget"|"new_creative"|"watch", "reason": string (1-2 câu tiếng Việt)}], "nextTest": string (1-3 câu gợi ý test tiếp)}',
  ].join("\n");
  const user = `Khoảng ${from} → ${to}. Bảng số liệu từng ad (đã cộng dồn):\n${JSON.stringify(table)}`;

  try {
    const out = await orChatJSON<Record<string, unknown>>(system, user, { model, maxTokens: 2200, temperature: 0.3, timeoutMs: 50000, reasoning: "low" });
    return NextResponse.json({ ok: true, from, to, table, ai: out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message).slice(0, 300) }, { status: 400 });
  }
}
