import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq, inArray, and, or, ilike, sql as dsql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf, hasRestriction } from "@/lib/rbac";
import { scopeOwnerIds, resolveScope } from "@/lib/scope";
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
  const scope = await resolveScope(session, "designs");
  const scopeIds = await scopeOwnerIds(session, "designs");
  if (scopeIds && scopeIds.length) {
    const idList = dsql.join(scopeIds.map((x) => dsql`${x}::uuid`), dsql`, `);
    // PHẠM VI (chốt 2026-07-20):
    // · scope TEAM = "dữ liệu THUẦN trong team": có người của team tham gia, VÀ seller lẫn designer (nếu có gán)
    //   đều phải thuộc team → không bao giờ thấy tên/dữ liệu team khác. Design lai 2 team chỉ admin/scope all thấy.
    // · scope OWN = theo VAI: designer thấy design mình vẽ/upload; seller thấy design shop mình.
    if (scope === "team") {
      parts.push(dsql`(
        (${schema.designs.designerId} IN (${idList}) OR ${schema.designs.sellerId} IN (${idList}) OR ${schema.designs.creatorId} IN (${idList}))
        AND (${schema.designs.sellerId} IS NULL OR ${schema.designs.sellerId} IN (${idList}))
        AND (${schema.designs.designerId} IS NULL OR ${schema.designs.designerId} IN (${idList}))
      )` as never);
    } else if (session.role === "designer") {
      parts.push(dsql`(${schema.designs.designerId} IN (${idList}) OR ${schema.designs.creatorId} IN (${idList}))` as never);
    } else if (session.role === "seller") {
      parts.push(dsql`(${schema.designs.sellerId} IN (${idList}) OR ${schema.designs.creatorId} IN (${idList}))` as never);
    } else {
      parts.push(dsql`(
        ${schema.designs.designerId} IN (${idList})
        OR ${schema.designs.sellerId} IN (${idList})
        OR ${schema.designs.creatorId} IN (${idList})
      )` as never);
    }
  }
  const q = sp.get("q")?.trim();
  if (q) {
    const clean = q.replace(/^#/, "").trim();
    if (/^\d+$/.test(clean)) {
      // Gõ SỐ → tìm theo ID (#skuCode) chính xác, HOẶC số đứng riêng trong tên
      // (tránh dính chuỗi số dài trong title auto-gen như ...0829122).
      const idNum = Number(clean);
      // sku_code là int4 → số quá 2,147,483,647 (VD dán nhầm ID đơn hàng) phải bỏ vế so sánh, tránh lỗi Postgres 22003 "out of range".
      parts.push(or(
        Number.isSafeInteger(idNum) && idNum <= 2_147_483_647 ? eq(schema.designs.skuCode, idNum) : dsql`false`,
        dsql`${schema.designs.title} ~ ${"(^|[^0-9])" + clean + "([^0-9]|$)"}`,
      )!);
    } else {
      // Gõ CHỮ → tìm theo tên
      parts.push(ilike(schema.designs.title, "%" + q + "%"));
    }
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
    // Cover mặc định = mặt trước; nếu không có thì mockup, rồi file đầu
    const front = f.find((x) => x.kind === "design_front");
    const cover = front ?? f.find((x) => x.kind === "mockup") ?? f[0];
    const main = front ?? cover;
    const m = mmap.get(d.id);
    // Các mặt/ảnh khác (khác cover) để hiện thumbnail dưới chân card
    const KIND_LABEL: Record<string, string> = { design_front: "Front", design_back: "Back", mockup: "Mockup", video: "Video" };
    const sides = f
      .filter((x) => x.id !== cover?.id && x.kind !== "video")
      .map((x) => ({ id: x.id, kind: x.kind, label: KIND_LABEL[x.kind] ?? x.kind, thumb: fileUrl(x.thumbKey) ?? fileUrl(x.previewKey), original: fileUrl(x.storageKey) }));
    return {
      ...d,
      filesCount: f.length,
      sellerName: m?.seller ?? null, designerName: m?.designer ?? null, creatorName: m?.creator ?? null,
      avgScore: m?.score ? Number(m.score) : null,
      dims: main?.width && main?.height ? `${main.width}x${main.height}` : null,
      sizeMB: main ? (Number(main.sizeBytes) / 1048576).toFixed(2) : null,
      downloadUrl: main ? fileUrl(main.storageKey) : null,
      coverLabel: cover && cover.kind !== "design_front" ? (KIND_LABEL[cover.kind] ?? cover.kind) : null,
      coverKind: cover && cover.kind !== "design_front" ? cover.kind : null,
      cover: cover
        ? { thumb: fileUrl(cover.thumbKey), preview: fileUrl(cover.previewKey), original: fileUrl(cover.storageKey), status: cover.processingStatus }
        : null,
      sides,
    };
  });
  let sellers = await cachedRoleUsers("seller");
  let designers = await cachedRoleUsers("designer");
  // Phạm vi own/team: dropdown hiện những seller/designer THỰC SỰ xuất hiện trong các design user được thấy
  // (designer scope own vẫn thấy design của nhiều seller mình vẽ → phải lọc được theo các seller đó;
  //  lọc theo "user trong phạm vi" như cũ làm dropdown rỗng → filter biến mất).
  if (scopeIds && scopeIds.length) {
    const idList = dsql.join(scopeIds.map((x) => dsql`${x}::uuid`), dsql`, `);
    // Giới hạn theo KHOẢNG NGÀY đang xem — tránh seller/designer của design cũ ngoài khoảng "lọt" vào dropdown.
    const dFrom = sp.get("from") ? dsql` AND d.created_at >= ${sp.get("from")}::date` : dsql``;
    const dTo = sp.get("to") ? dsql` AND d.created_at < (${sp.get("to")}::date + 1)` : dsql``;
    // CÙNG điều kiện phạm vi như lưới — dropdown phản chiếu đúng những design user thấy.
    const roleCond = scope === "team"
      ? dsql`((d.designer_id IN (${idList}) OR d.seller_id IN (${idList}) OR d.creator_id IN (${idList})) AND (d.seller_id IS NULL OR d.seller_id IN (${idList})) AND (d.designer_id IS NULL OR d.designer_id IN (${idList})))`
      : session.role === "designer"
        ? dsql`(d.designer_id IN (${idList}) OR d.creator_id IN (${idList}))`
        : session.role === "seller"
          ? dsql`(d.seller_id IN (${idList}) OR d.creator_id IN (${idList}))`
          : dsql`(d.designer_id IN (${idList}) OR d.seller_id IN (${idList}) OR d.creator_id IN (${idList}))`;
    const vis = (await db.execute(dsql`
      SELECT DISTINCT d.seller_id, d.designer_id
      FROM designs d
      WHERE ${roleCond}${dFrom}${dTo}
    `)).rows as { seller_id: string | null; designer_id: string | null }[];
    const visSellers = new Set(vis.map((v) => v.seller_id).filter(Boolean) as string[]);
    const visDesigners = new Set(vis.map((v) => v.designer_id).filter(Boolean) as string[]);
    sellers = sellers.filter((u) => visSellers.has(u.id));
    designers = designers.filter((u) => visDesigners.has(u.id));
  }
  return NextResponse.json({ ok: true, designs: out, total, page, show, sellers, designers, scoped: !!scopeIds });
}

// Cache danh sách seller/designer (đổi rất ít) trong 60s → giảm 2 truy vấn DB mỗi lần load lưới.
type RoleUser = { id: string; name: string };
const roleCache: Record<string, { at: number; rows: RoleUser[] }> = {};
async function cachedRoleUsers(role: "seller" | "designer"): Promise<RoleUser[]> {
  const c = roleCache[role];
  if (c && Date.now() - c.at < 60_000) return c.rows;
  const { sql: s } = await import("drizzle-orm");
  const rows = (await db.execute(s`SELECT id, full_name AS name FROM users WHERE role=${role} ORDER BY full_name`)).rows as RoleUser[];
  roleCache[role] = { at: Date.now(), rows };
  return rows;
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
