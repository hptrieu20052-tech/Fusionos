import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { scopeOwnerIds } from "@/lib/scope";
import { rangeCond, isMonthly, bucketExprs } from "@/lib/ranges";

export const dynamic = "force-dynamic";

// GET ?range=today|yesterday|7d|this_month|last_month|this_year|all&by=designer|content
// Mỗi người: design/ngày (stacked), sale phát sinh từ design của họ (đơn + doanh thu),
// điểm review TB trong kỳ, KPI tổng hợp 40/30/30 → xếp hạng.
// by=designer → gom theo designs.designer_id (người thiết kế).
// by=content  → gom theo designs.creator_id  (bạn Content; đúng cột mà ô "Creator" trong
//               màn hình Design đang ghi, danh sách chọn ở đó đã lọc sẵn role='content').
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const by = sp.get("by") === "content" ? "content" : "designer";
  // Creator report (by=content) mở cho người có quyền videos — creator thường không có designs.
  const okDesigns = (await levelOf(session, "designs")) >= 1;
  const okVideos = (await levelOf(session, "videos")) >= 1;
  // Creator (videos) xem được cả Designer report lẫn Creator report của team.
  if (!(okDesigns || okVideos)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  try { // v472 · bắt lỗi DB/timeout và trả NGUYÊN VĂN về client để hiển thị (chẩn đoán report lỗi với scope rộng)
  const PC = by === "content" ? "creator_id" : "designer_id"; // cột gom nhóm
  const range = sp.get("range") ?? "this_month";
  const from = sp.get("from"), to = sp.get("to");
  const monthly = isMonthly(range, from, to);
  const cond = (col: string) => rangeCond(col, range, from, to);
  const bucket = (col: string) => bucketExprs(col, monthly).bucketExpr;
  const bucketOrd = (col: string) => bucketExprs(col, monthly).bucketOrd;

  // Phạm vi: team/own → chỉ designer trong phạm vi
  const scopeIds = await scopeOwnerIds(session, "dashboard");
  const inD = scopeIds ? sql` AND d.${sql.raw(PC)} IN (${sql.join(scopeIds.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``;
  // v210c · Với Creator (by=content), phạm vi lọc theo người quay video.
  const vPid = sql`coalesce(v.creator_id, v.uploaded_by)`;
  const inV = scopeIds ? sql` AND ${vPid} IN (${sql.join(scopeIds.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``;

  // v471 · 4 query CHẠY SONG SONG (Promise.all) thay vì tuần tự — trước đây await lần lượt nên tổng
  //        thời gian = cộng dồn, với scope rộng (admin/all) dễ vượt timeout serverless → request treo →
  //        UI kẹt "Loading". Song song → tổng ≈ query lâu nhất, giảm mạnh nguy cơ timeout.
  //  (1) Design tạo trong kỳ theo người × bucket (kèm points cho KPI).
  //  (2) [by=content] SỐ VIDEO trong kỳ (cột riêng, KHÔNG thay Design).
  //  (3) Sale trong kỳ = SỐ DÒNG order_item có design của người đó (mỗi item/design được assign = 1 sale),
  //      theo o.ordered_at — cùng cơ sở Seller/Orders/Dashboard: chỉ bỏ cancel/trash, GỒM cả đơn NEW.
  //      1 order có 2 item khác design của cùng 1 người vẫn tính 2. Không phụ thuộc thời gian upload/assign.
  //  (4) Điểm review trong kỳ theo người.
  // v478 · KHÔNG loại design CHƯA GÁN người nữa (bỏ "PC IS NOT NULL") — gom vào dòng "(chưa gán)"
  //        để tổng Design khớp với Design Studio (trước lệch: Studio đếm tất, report chỉ đếm đã gán).
  //        Với scope team/own thì inD (IN danh sách uuid) tự loại NULL → không lộ design team khác.
  const [dz, vidCounts, sales, scores] = await Promise.all([
    db.execute(sql`
      SELECT ${sql.raw(bucket("d.created_at"))} AS bucket, min(${sql.raw(bucketOrd("d.created_at"))}) AS ord,
             d.${sql.raw(PC)} AS pid, coalesce(u.full_name,'(Unassigned)') AS name,
             count(*)::int AS c, coalesce(sum(d.points),0)::int AS pts
      FROM designs d LEFT JOIN users u ON u.id = d.${sql.raw(PC)}
      WHERE ${sql.raw(cond("d.created_at"))}${inD}
      GROUP BY 1, d.${sql.raw(PC)}, u.full_name ORDER BY ord
    `),
    by === "content"
      ? db.execute(sql`
          SELECT ${vPid} AS pid, count(*)::int AS n
          FROM product_videos v
          WHERE ${sql.raw(cond("v.created_at"))} AND ${vPid} IS NOT NULL${inV}
          GROUP BY 1
        `)
      : Promise.resolve({ rows: [] as { pid: string; n: number }[] }),
    db.execute(sql`
      SELECT ${sql.raw(bucket("o.ordered_at"))} AS bucket, min(${sql.raw(bucketOrd("o.ordered_at"))}) AS ord,
             d.${sql.raw(PC)} AS pid,
             count(*)::int AS orders, coalesce(sum(oi.qty * oi.unit_price),0)::numeric AS revenue
      FROM order_items oi
      JOIN designs d ON d.id = oi.design_id
      JOIN orders o ON o.id = oi.order_id
      WHERE ${sql.raw(cond("o.ordered_at"))} AND o.status NOT IN ('cancel','trash')${inD}
      GROUP BY 1, d.${sql.raw(PC)} ORDER BY ord
    `),
    db.execute(sql`
      SELECT d.${sql.raw(PC)} AS pid, avg(r.total_score)::numeric(4,2) AS score, count(*)::int AS reviews
      FROM design_reviews r JOIN designs d ON d.id = r.design_id
      WHERE ${sql.raw(cond("r.created_at"))}${inD}
      GROUP BY 1
    `),
  ]);

  type DzRow = { bucket: string; ord: string; pid: string | null; name: string; c: number; pts: number };
  type SaleRow = { bucket: string; ord: string; pid: string | null; orders: number; revenue: string };
  // v478 · pid=null (design chưa gán người) → gom về 1 dòng "(chưa gán)" (khoá "unassigned").
  const pk = (id: string | null) => id ?? "unassigned";
  const dzRows = dz.rows as DzRow[];
  const saleRows = sales.rows as SaleRow[];

  // Buckets = hợp 2 nguồn, sắp theo thời gian
  const bmap = new Map<string, string>();
  for (const r of [...dzRows, ...saleRows]) if (!bmap.has(r.bucket) || r.ord < bmap.get(r.bucket)!) bmap.set(r.bucket, r.ord);
  const buckets = Array.from(bmap.entries()).sort((a, b) => a[1] < b[1] ? -1 : 1).map(([b]) => b);
  const bIdx = new Map(buckets.map((b, i) => [b, i]));

  const dmap = new Map<string, { id: string; name: string; designs: number; videos: number; points: number; salesOrders: number; salesRevenue: number; avgScore: number; reviews: number; daily: { d: number; s: number }[] }>();
  const ensure = (id: string, name?: string) => {
    if (!dmap.has(id)) dmap.set(id, { id, name: name ?? "", designs: 0, videos: 0, points: 0, salesOrders: 0, salesRevenue: 0, avgScore: 0, reviews: 0, daily: buckets.map(() => ({ d: 0, s: 0 })) });
    return dmap.get(id)!;
  };
  for (const r of dzRows) { const x = ensure(pk(r.pid), r.name); x.name = r.name; x.designs += r.c; x.points += r.pts; x.daily[bIdx.get(r.bucket)!].d = r.c; }
  for (const r of saleRows) { const x = ensure(pk(r.pid), r.pid == null ? "(Unassigned)" : undefined); x.salesOrders += r.orders; x.salesRevenue += Number(r.revenue); x.daily[bIdx.get(r.bucket)!].s = r.orders; }
  for (const r of scores.rows as { pid: string | null; score: string; reviews: number }[]) {
    const x = dmap.get(pk(r.pid)); if (x) { x.avgScore = Number(r.score); x.reviews = r.reviews; }
  }
  for (const r of vidCounts.rows as { pid: string; n: number }[]) { ensure(r.pid).videos += r.n; }
  // Bổ sung tên cho người chỉ có sale (không có design mới trong kỳ) — bỏ qua khoá "(chưa gán)" (không phải uuid)
  const missing = Array.from(dmap.values()).filter((x) => !x.name && x.id !== "unassigned").map((x) => x.id);
  if (missing.length) {
    // v475 · FIX lỗi "malformed array literal" / "cannot cast type record to uuid[]": KHÔNG nhúng mảng JS
    // thẳng vào sql`ANY(${arr}::uuid[])` (drizzle bung thành ($1,$2) = record). Dùng IN (...) như inD.
    const names = await db.execute(sql`SELECT id, full_name FROM users WHERE id IN (${sql.join(missing.map((x) => sql`${x}::uuid`), sql`, `)})`);
    for (const n of names.rows as { id: string; full_name: string }[]) { const x = dmap.get(n.id); if (x) x.name = n.full_name; }
  }

  // KPI 40/30/30: sản lượng (points chuẩn hoá) · chất lượng (điểm review, mặc định 5 nếu chưa chấm) · kinh doanh (đơn phát sinh chuẩn hoá)
  const list = Array.from(dmap.values());
  const maxPts = Math.max(...list.map((x) => x.points), 1);
  const maxBiz = Math.max(...list.map((x) => x.salesOrders), 1);
  const designers = list.map((x) => ({
    ...x,
    salesRevenue: Number(x.salesRevenue.toFixed(2)),
    kpi: Number(((x.points / maxPts) * 10 * 0.4 + (x.avgScore || 5) * 0.3 + (x.salesOrders / maxBiz) * 10 * 0.3).toFixed(1)),
  })).sort((a, b) => {
    // v481 · KPI đang ẩn trên UI → xếp theo SỐ DESIGN (tie-break: item sale) cho trực quan;
    //        "(Unassigned)" luôn nằm CUỐI bảng (không phải người, không tranh hạng).
    const ua = a.id === "unassigned", ub = b.id === "unassigned";
    if (ua !== ub) return ua ? 1 : -1;
    return (b.designs - a.designs) || (b.salesOrders - a.salesOrders);
  });

  const totals = {
    designs: designers.reduce((a, x) => a + x.designs, 0),
    videos: designers.reduce((a, x) => a + x.videos, 0),
    salesOrders: designers.reduce((a, x) => a + x.salesOrders, 0),
    salesRevenue: Number(designers.reduce((a, x) => a + x.salesRevenue, 0).toFixed(2)),
  };
  // Ẩn doanh thu với non-admin (tránh hiểu nhầm; số vẫn giữ cho admin)
  const showMoney = session.role === "admin";
  const designersOut = showMoney ? designers : designers.map((x) => ({ ...x, salesRevenue: 0 }));
  const totalsOut = showMoney ? totals : { ...totals, salesRevenue: 0 };
  return NextResponse.json({ ok: true, range, by, buckets, designers: designersOut, totals: totalsOut });
  } catch (e) {
    console.error("designer-report error:", e);
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e) });
  }
}
