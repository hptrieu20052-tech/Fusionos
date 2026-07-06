import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

// GET — hàng chờ chấm: design chưa có review, mới nhất trước
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const rows = await db.execute(sql`
    SELECT d.id, d.sku_code, d.title, d.points, d.created_at, u.full_name designer,
      (SELECT thumb_key FROM design_files f WHERE f.design_id = d.id AND f.thumb_key IS NOT NULL LIMIT 1) thumb,
      (SELECT count(*)::int FROM order_items oi WHERE oi.design_id = d.id) biz_items,
      (SELECT count(*)::int FROM design_reviews r WHERE r.design_id = d.id) reviewed
    FROM designs d LEFT JOIN users u ON u.id = d.designer_id
    ORDER BY reviewed ASC, d.created_at DESC LIMIT 40
  `);
  return NextResponse.json({
    ok: true,
    designs: (rows.rows as Record<string, unknown>[]).map((r) => ({ ...r, thumb: fileUrl(r.thumb as string | null) })),
  });
}

// POST — lưu review theo rubric 30/40/30
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const s = (v: unknown) => Number(v) >= 1 && Number(v) <= 10 ? Number(v) : null;
  if (!b?.designId || !["approve", "request_fix", "reject"].includes(b.decision) || !s(b.scoreBrief) || !s(b.scoreAesthetic) || !s(b.scoreTechnical)) {
    return NextResponse.json({ ok: false, error: "invalid: cần 3 điểm 1-10 + decision" }, { status: 400 });
  }
  const [d] = await db.select().from(schema.designs).where(eq(schema.designs.id, b.designId)).limit(1);
  if (!d) return NextResponse.json({ ok: false, error: "design not found" }, { status: 404 });

  // 30% chất lượng (chấm tay)
  const quality = (s(b.scoreBrief)! + s(b.scoreAesthetic)! + s(b.scoreTechnical)!) / 3;
  // 40% sản lượng & kỷ luật (tự động): độ khó điểm hoá — sẽ thay bằng deadline/số lần sửa khi có design_requests
  const discipline = Math.min(10, 5 + d.points * 1.5);
  // 30% hiệu quả (tự động): đơn phát sinh 30 ngày, 10 đơn = 10 điểm (cap)
  const biz = await db.execute(sql`
    SELECT count(DISTINCT oi.order_id)::int c FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE oi.design_id = ${d.id} AND o.ordered_at > NOW() - interval '30 days'`);
  const bizOrders = (biz.rows[0] as { c: number }).c;
  const business = Math.min(10, bizOrders);
  const total = quality * 0.3 + discipline * 0.4 + business * 0.3;

  const [r] = await db.insert(schema.designReviews).values({
    designId: d.id, reviewerId: session.sub,
    scoreBrief: s(b.scoreBrief)!, scoreAesthetic: s(b.scoreAesthetic)!, scoreTechnical: s(b.scoreTechnical)!,
    qualityScore: quality.toFixed(2), disciplineScore: discipline.toFixed(2), businessScore: business.toFixed(2),
    totalScore: total.toFixed(2), decision: b.decision, comment: b.comment,
  }).returning();

  return NextResponse.json({ ok: true, review: r, breakdown: { quality, discipline, business, bizOrders, total } });
}
