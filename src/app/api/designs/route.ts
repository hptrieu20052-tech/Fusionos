import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq, inArray, and, or, ilike, sql as dsql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf, hasRestriction } from "@/lib/rbac";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

// GET /api/designs — grid Design Studio (chỉ trả thumb/preview, KHÔNG trả file gốc)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const show = Math.min(Math.max(Number(sp.get("show") ?? 24), 8), 60);
  const page = Math.max(Number(sp.get("page") ?? 1), 1);

  const parts = [] as ReturnType<typeof eq>[];
  if (await hasRestriction(session.sub, "own_designs_only")) parts.push(eq(schema.designs.designerId, session.sub));
  const q = sp.get("q")?.trim();
  if (q) {
    const like = "%" + q + "%";
    const idNum = Number(q);
    parts.push(or(ilike(schema.designs.title, like), Number.isInteger(idNum) ? eq(schema.designs.skuCode, idNum) : dsql`false`)!);
  }
  if (sp.get("platform")) parts.push(eq(schema.designs.platform, sp.get("platform") as never));
  if (sp.get("sellerId")) parts.push(eq(schema.designs.sellerId, sp.get("sellerId")!));
  if (sp.get("designerId")) parts.push(eq(schema.designs.designerId, sp.get("designerId")!));
  if (sp.get("from")) parts.push(dsql`${schema.designs.createdAt} >= ${sp.get("from")}::date` as never);
  if (sp.get("to")) parts.push(dsql`${schema.designs.createdAt} < (${sp.get("to")}::date + 1)` as never);
  const conds = parts.length ? and(...parts) : undefined;

  // Đếm tổng: khi KHÔNG lọc gì → dùng ước lượng nhanh từ thống kê bảng (tránh count(*) toàn bảng lớn).
  // Khi CÓ lọc → count chính xác (đã có index nên nhanh).
  let total: number;
  if (!parts.length) {
    const est = await db.execute(dsql`SELECT reltuples::bigint AS c FROM pg_class WHERE relname = 'designs'`);
    total = Number((est.rows[0] as { c: string })?.c ?? 0);
    // Nếu bảng còn nhỏ (chưa ANALYZE) thì ước lượng có thể = 0/âm → count thật
    if (total < 1000) {
      const r = await db.select({ c: dsql<number>`count(*)::int` }).from(schema.designs);
      total = r[0]?.c ?? 0;
    }
  } else {
    const r = await db.select({ c: dsql<number>`count(*)::int` }).from(schema.designs).where(conds);
    total = r[0]?.c ?? 0;
  }

  const rows = await db.select().from(schema.designs).where(conds).orderBy(desc(schema.designs.createdAt)).limit(show).offset((page - 1) * show);
  const ids = rows.map((d) => d.id);
  const files = ids.length
    ? await db.select().from(schema.designFiles).where(inArray(schema.designFiles.designId, ids))
    : [];

  // Tên người liên quan + điểm TB cho card
  const { sql } = await import("drizzle-orm");
  const meta = ids.length ? (await db.execute(sql`
    SELECT d.id,
      su.full_name AS seller, du.full_name AS designer, cu.full_name AS creator,
      (SELECT avg(total_score)::numeric(4,2) FROM design_reviews r WHERE r.design_id = d.id) AS score
    FROM designs d
    LEFT JOIN users su ON su.id = d.seller_id
    LEFT JOIN users du ON du.id = d.designer_id
    LEFT JOIN users cu ON cu.id = d.creator_id
    WHERE d.id IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})
  `)).rows as { id: string; seller: string | null; designer: string | null; creator: string | null; score: string | null }[] : [];
  const mmap = new Map(meta.map((m) => [m.id, m]));

  const out = rows.map((d) => {
    const f = files.filter((x) => x.designId === d.id);
    const cover = f.find((x) => x.kind === "mockup") ?? f[0];
    const main = f.find((x) => x.kind === "design_front") ?? cover;
    const m = mmap.get(d.id);
    return {
      ...d,
      filesCount: f.length,
      sellerName: m?.seller ?? null, designerName: m?.designer ?? null, creatorName: m?.creator ?? null,
      avgScore: m?.score ? Number(m.score) : null,
      dims: main?.width && main?.height ? `${main.width}x${main.height}` : null,
      sizeMB: main ? (Number(main.sizeBytes) / 1048576).toFixed(2) : null,
      downloadUrl: main ? fileUrl(main.storageKey) : null,
      cover: cover
        ? { thumb: fileUrl(cover.thumbKey), preview: fileUrl(cover.previewKey), original: fileUrl(cover.storageKey), status: cover.processingStatus }
        : null,
    };
  });
  const sellers = (await db.execute(dsql`SELECT id, full_name AS name FROM users WHERE role='seller' ORDER BY full_name`)).rows;
  const designers = (await db.execute(dsql`SELECT id, full_name AS name FROM users WHERE role='designer' ORDER BY full_name`)).rows;
  return NextResponse.json({ ok: true, designs: out, total, page, show, sellers, designers });
}

// POST /api/designs — tạo design mới
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b?.title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });

  const [d] = await db.insert(schema.designs).values({
    title: String(b.title).trim(),
    description: b.description,
    points: [1, 2, 3].includes(b.points) ? b.points : 1,
    platform: schema.designs.platform.enumValues.includes(b.platform) ? b.platform : null,
    designerId: session.role === "designer" ? session.sub : b.designerId ?? null,
    sellerId: session.role === "seller" ? session.sub : b.sellerId ?? null,
    personalize: !!b.personalize,
  }).returning();
  return NextResponse.json({ ok: true, design: d });
}
