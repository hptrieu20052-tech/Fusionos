import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { scopeOwnerIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * v236 · Performance của video theo UTM.
 *   GET /api/videos/performance?codes=2,5,7
 * Quy đơn về video qua orders.utm_campaign = "video_<videoCode>", tách theo kênh (utm_source).
 * CHỈ tính đơn về SAU khi link phân phối bắt đầu được dùng (đơn cũ không có UTM).
 * Trả: { ok, perf: { "<code>": { orders, revenue, channels: { <source>: { orders, revenue } } } } }
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "videos")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // codes=2,5,7 → chỉ giữ số nguyên dương, tối đa 100 mã / lần
  const codes = String(req.nextUrl.searchParams.get("codes") ?? "")
    .split(",").map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 100);
  const perf: Record<string, { orders: number; revenue: number; channels: Record<string, { orders: number; revenue: number }> }> = {};
  if (!codes.length) return NextResponse.json({ ok: true, perf });

  const campaigns = codes.map((c) => `video_${c}`);
  const conds = [inArray(schema.orders.utmCampaign, campaigns)];
  // Seller chỉ thấy đơn thuộc phạm vi mình (group theo chủ shop tại thời điểm đơn về).
  const ownIds = await scopeOwnerIds(session, "orders");
  if (ownIds) conds.push(inArray(schema.orders.sellerAtOrder, ownIds));

  const rows = await db.select({
    campaign: schema.orders.utmCampaign,
    source: schema.orders.utmSource,
    n: sql<number>`count(*)::int`,
    rev: sql<number>`coalesce(sum(${schema.orders.total}),0)::float`,
  }).from(schema.orders)
    .where(and(...conds))
    .groupBy(schema.orders.utmCampaign, schema.orders.utmSource);

  for (const r of rows) {
    const code = String(r.campaign ?? "").replace(/^video_/, "");
    if (!code) continue;
    const p = perf[code] ?? (perf[code] = { orders: 0, revenue: 0, channels: {} });
    const orders = Number(r.n) || 0;
    const revenue = Math.round((Number(r.rev) || 0) * 100) / 100;
    p.orders += orders;
    p.revenue = Math.round((p.revenue + revenue) * 100) / 100;
    const src = (r.source ?? "other").toLowerCase();
    const c = p.channels[src] ?? (p.channels[src] = { orders: 0, revenue: 0 });
    c.orders += orders;
    c.revenue = Math.round((c.revenue + revenue) * 100) / 100;
  }

  return NextResponse.json({ ok: true, perf });
}
