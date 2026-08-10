import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * v209 · GET /api/stats/creators?days=7  (hoặc ?from=&to=)
 * Bản song sinh của /api/stats/designers, nhưng đếm VIDEO thay vì design.
 *
 * Mỗi creator:
 *   · values[]  — số video upload theo từng ngày (để vẽ heat + bar)
 *   · approved / rejected / pending  — chất lượng đầu ra
 *   · listings   — số listing đang HIỆN video của người này (tác động thật, không phải số upload)
 *   · onShopify  — số listing đã đẩy video lên Shopify xong
 *
 * KPI = 40% sản lượng (video được duyệt) + 30% chất lượng (tỉ lệ duyệt) + 30% tác động (listing phủ).
 * Cùng công thức trọng số với Designer để hai bảng đọc như nhau.
 *
 * Quyền: videos ≥2 (hoặc admin) xem toàn đội · videos =1 chỉ xem của chính mình.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const lvl = await levelOf(session, "videos");
  if (lvl < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const seeAll = session.role === "admin" || lvl >= 2;

  let days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") ?? 7), 1), 31);
  const dOk = (x: string | null) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const fromQ = dOk(req.nextUrl.searchParams.get("from"));
  const toQ = dOk(req.nextUrl.searchParams.get("to"));
  const useRange = !!(fromQ && toQ);
  if (useRange) days = Math.min(Math.max(Math.round((Date.parse(toQ!) - Date.parse(fromQ!)) / 86400000) + 1, 1), 92);
  const FROM = useRange ? sql`${fromQ}::date` : sql`CURRENT_DATE - (${days - 1})::int`;
  const TO = useRange ? sql`${toQ}::date` : sql`CURRENT_DATE`;

  // Người chỉ có quyền xem (level 1) thì chỉ thấy số của chính mình.
  const mine = seeAll ? sql`` : sql` AND v.uploaded_by = ${session.sub}::uuid`;

  const daily = await db.execute(sql`
    SELECT u.id creator_id, u.full_name name, v.created_at::date dd, count(*)::int n
    FROM product_videos v JOIN users u ON u.id = v.uploaded_by
    WHERE v.created_at::date >= ${FROM} AND v.created_at::date <= ${TO}${mine}
    GROUP BY 1,2,3
  `);

  // Trạng thái duyệt tính trên CÙNG khoảng ngày, để tỉ lệ duyệt khớp với số upload đang hiện.
  const statuses = await db.execute(sql`
    SELECT v.uploaded_by creator_id, v.status, count(*)::int n
    FROM product_videos v
    WHERE v.uploaded_by IS NOT NULL
      AND v.created_at::date >= ${FROM} AND v.created_at::date <= ${TO}${mine}
    GROUP BY 1,2
  `);

  // Tác động: listing đang gán video của creator (KHÔNG giới hạn ngày — video cũ vẫn đang chạy).
  const impact = await db.execute(sql`
    SELECT v.uploaded_by creator_id,
           count(sp.id)::int listings,
           count(sp.video_pushed_at)::int on_shopify
    FROM shopify_products sp JOIN product_videos v ON v.id = sp.video_id
    WHERE v.uploaded_by IS NOT NULL${mine}
    GROUP BY 1
  `);

  const dayList: string[] = [];
  const anchor = useRange ? new Date(toQ! + "T00:00:00Z") : new Date();
  for (let i = days - 1; i >= 0; i--) { const dt = new Date(anchor); dt.setDate(dt.getDate() - i); dayList.push(dt.toISOString().slice(0, 10)); }

  const rows = daily.rows as { creator_id: string; name: string; dd: string; n: number }[];
  const stRows = statuses.rows as { creator_id: string; status: string; n: number }[];
  const imRows = impact.rows as { creator_id: string; listings: number; on_shopify: number }[];
  const imMap = new Map(imRows.map((x) => [x.creator_id, x]));
  const stOf = (id: string, s: string) => stRows.find((x) => x.creator_id === id && x.status === s)?.n ?? 0;

  const creators = Array.from(new Map(rows.map((x) => [x.creator_id, x.name])).entries()).map(([id, name]) => {
    const values = dayList.map((d) => rows.filter((x) => x.creator_id === id && String(x.dd).slice(0, 10) === d).reduce((t, x) => t + x.n, 0));
    const total = values.reduce((a, b) => a + b, 0);
    const approved = stOf(id, "approved"), rejected = stOf(id, "rejected"), pending = stOf(id, "pending");
    const judged = approved + rejected;
    return {
      id, name, values, total, approved, rejected, pending,
      // Tỉ lệ duyệt chỉ tính trên phần ĐÃ XÉT — video còn pending không kéo tỉ lệ xuống oan.
      approvalRate: judged ? Math.round((approved / judged) * 100) : null,
      listings: imMap.get(id)?.listings ?? 0,
      onShopify: imMap.get(id)?.on_shopify ?? 0,
    };
  });

  const maxOut = Math.max(...creators.map((c) => c.approved), 1);
  const maxImp = Math.max(...creators.map((c) => c.listings), 1);
  const out = creators.map((c) => ({
    ...c,
    kpi: Number((
      (c.approved / maxOut) * 10 * 0.4
      + ((c.approvalRate ?? 100) / 10) * 0.3
      + (c.listings / maxImp) * 10 * 0.3
    ).toFixed(1)),
  })).sort((a, b) => b.kpi - a.kpi);

  const totals = dayList.map((_, i) => out.reduce((t, c) => t + c.values[i], 0));
  return NextResponse.json({
    ok: true, seeAll, dayList, totals, creators: out,
    grand: totals.reduce((a, b) => a + b, 0),
  });
}
