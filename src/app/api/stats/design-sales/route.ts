import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/design-sales — DESIGN nào ra bao nhiêu SALE (cho Designer + Creator Content).
 *
 * Query:
 *   from/to (yyyy-mm-dd) | days=30      — khoảng thời gian tính sale (theo orders.ordered_at)
 *   q=<text>                            — tìm theo title hoặc SKU code
 *   platform=tiktok|etsy|shopify|...    — marketplace của design
 *   sellerId / designerId / creatorId   — lọc theo người
 *   sales=has|none|all (mặc định has)   — has: chỉ design CÓ sale trong khoảng; none: design chưa ra sale nào
 *   sort=orders|qty|revenue|newest      — mặc định orders (giảm dần)
 *   limit (≤200, mặc định 50) / offset
 *
 * Phân quyền: admin + role content thấy tất; còn lại theo scope "designs" (own/team) — design nào
 * mình là designer HOẶC creator HOẶC seller thì thấy. Sale đếm đơn không tính new/cancel/trash.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.role !== "admin" && session.role !== "content" && (await levelOf(session, "designs")) < 1) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const sp = req.nextUrl.searchParams;

  // ---- Khoảng thời gian ----
  const dOk = (x: string | null) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const fromQ = dOk(sp.get("from"));
  const toQ = dOk(sp.get("to"));
  let days = Math.min(Math.max(Number(sp.get("days") ?? 30), 1), 366);
  const useRange = !!(fromQ && toQ);
  if (useRange) days = Math.min(Math.max(Math.round((Date.parse(toQ!) - Date.parse(fromQ!)) / 86400000) + 1, 1), 366);
  const FROM = useRange ? sql`${fromQ}::date` : sql`CURRENT_DATE - (${days - 1})::int`;
  const TO = useRange ? sql`${toQ}::date` : sql`CURRENT_DATE`;

  // ---- Filters ----
  const uuidOk = (x: string | null) => (x && /^[0-9a-f-]{36}$/i.test(x) ? x : null);
  const q = (sp.get("q") ?? "").trim().slice(0, 120);
  const platform = (sp.get("platform") ?? "").trim();
  const sellerId = uuidOk(sp.get("sellerId"));
  const designerId = uuidOk(sp.get("designerId"));
  const creatorId = uuidOk(sp.get("creatorId"));
  const salesF = ["has", "none", "all"].includes(sp.get("sales") ?? "") ? sp.get("sales")! : "has";
  let sortF = ["orders", "qty", "revenue", "newest"].includes(sp.get("sort") ?? "") ? sp.get("sort")! : "orders";
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50), 1), 200);
  const offset = Math.max(Number(sp.get("offset") ?? 0), 0);

  // ---- Scope (v176b): admin thấy tất + thấy tiền. Mọi role khác: CHỈ team mình, KHÔNG thấy tiền.
  // Team xác định theo SELLER của design — design gán chéo cho seller team khác bị ẩn hoàn toàn
  // (kể cả khi mình đứng tên designer/creator trên đó).
  const isAdmin = session.role === "admin";
  let teamIds: string[] | null = null;
  if (!isAdmin) {
    const [me] = await db.select({ team: schema.users.team }).from(schema.users).where(eq(schema.users.id, session.sub)).limit(1);
    if (me?.team) {
      const members = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.team, me.team));
      teamIds = members.map((m) => m.id);
    } else {
      teamIds = [session.sub]; // chưa vào team nào → chỉ thấy design mình đứng tên seller
    }
  }

  const conds = [sql`TRUE`];
  if (teamIds) {
    const idsSql = sql.join(teamIds.map((x) => sql`${x}::uuid`), sql`, `);
    conds.push(sql`d.seller_id IN (${idsSql})`);
  }
  if (q) {
    // Tìm theo title (ILIKE, có index trigram) hoặc đúng số SKU
    const num = Number(q.replace(/^TLW-?0*/i, ""));
    conds.push(Number.isInteger(num) && num > 0
      ? sql`(d.title ILIKE ${"%" + q + "%"} OR d.sku_code = ${num})`
      : sql`d.title ILIKE ${"%" + q + "%"}`);
  }
  if (sellerId) conds.push(sql`d.seller_id = ${sellerId}::uuid`);
  if (designerId) conds.push(sql`d.designer_id = ${designerId}::uuid`);
  if (creatorId) conds.push(sql`d.creator_id = ${creatorId}::uuid`);
  const WHERE = sql.join(conds, sql` AND `);
  // v176d · Marketplace = SÀN RA SALE (lấy từ đơn), không phải trường platform gắn trên design
  // (đa số trống). Filter khớp khi design bán trên sàn đó HOẶC design được gắn tay platform đó.
  // Điều kiện này tham chiếu s.platforms nên chỉ dùng ở query chính + count (có JOIN s).
  const PLATC = platform
    ? sql` AND (position(${platform} in coalesce(s.platforms, '')) > 0 OR d.platform = ${platform}::marketplace)`
    : sql``;

  // ---- Sale trong khoảng, gộp trước theo design (1 lần, không lateral từng dòng) ----
  const SALES_CTE = sql`
    SELECT oi.design_id,
           count(DISTINCT oi.order_id)::int AS orders,
           coalesce(sum(oi.qty), 0)::int AS qty,
           coalesce(sum(oi.qty * oi.unit_price), 0)::numeric(14,2) AS revenue,
           max(o.ordered_at) AS last_order,
           string_agg(DISTINCT o.platform::text, ',') AS platforms
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.design_id IS NOT NULL
      AND o.status NOT IN ('new','cancel','trash')
      AND o.ordered_at::date >= ${FROM} AND o.ordered_at::date <= ${TO}
    GROUP BY 1`;

  if (!isAdmin && sortF === "revenue") sortF = "orders"; // không thấy tiền thì không sort theo tiền

  const JOIN = salesF === "has" ? sql`JOIN` : sql`LEFT JOIN`;
  const NONE = salesF === "none" ? sql` AND s.design_id IS NULL` : sql``;
  const ORDER =
    sortF === "newest" ? sql`d.created_at DESC` :
    sortF === "qty" ? sql`coalesce(s.qty,0) DESC, d.created_at DESC` :
    sortF === "revenue" ? sql`coalesce(s.revenue,0) DESC, d.created_at DESC` :
    sql`coalesce(s.orders,0) DESC, coalesce(s.qty,0) DESC, d.created_at DESC`;

  const rows = (await db.execute(sql`
    WITH s AS (${SALES_CTE})
    SELECT d.id, d.sku_code, d.title, d.platform, d.created_at, d.product_link,
           su.full_name AS seller, du.full_name AS designer, cu.full_name AS creator,
           st.name AS store,
           coalesce(s.orders, 0) AS orders, coalesce(s.qty, 0) AS qty,
           coalesce(s.revenue, 0) AS revenue, s.last_order, s.platforms
    FROM designs d
    ${JOIN} s ON s.design_id = d.id
    LEFT JOIN users su ON su.id = d.seller_id
    LEFT JOIN users du ON du.id = d.designer_id
    LEFT JOIN users cu ON cu.id = d.creator_id
    LEFT JOIN stores st ON st.id = d.store_id
    WHERE ${WHERE}${NONE}${PLATC}
    ORDER BY ${ORDER}
    LIMIT ${limit} OFFSET ${offset}
  `)).rows as {
    id: string; sku_code: number; title: string; platform: string | null; created_at: string; product_link: string | null;
    seller: string | null; designer: string | null; creator: string | null; store: string | null;
    orders: number; qty: number; revenue: string; last_order: string | null; platforms: string | null;
  }[];

  const [{ total }] = (await db.execute(sql`
    WITH s AS (${SALES_CTE})
    SELECT count(*)::int AS total
    FROM designs d ${JOIN} s ON s.design_id = d.id
    WHERE ${WHERE}${NONE}${PLATC}
  `)).rows as { total: number }[];

  // ---- Thumbnail cho đúng trang này (front > mockup > file thường; bỏ .dst/video) ----
  // v176c · trả kèm bản preview to để UI mở lightbox khi click thumbnail.
  const ids = rows.map((r) => r.id);
  const thumbBy = new Map<string, { thumb: string | null; preview: string | null }>();
  if (ids.length) {
    const fr = (await db.execute(sql`
      SELECT DISTINCT ON (design_id) design_id, thumb_key, preview_key
      FROM design_files
      WHERE design_id IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})
        AND kind <> 'video'
        AND coalesce(filename, '') NOT ILIKE '%.dst'
        AND coalesce(storage_key, '') NOT ILIKE '%.dst'
      ORDER BY design_id, (kind = 'design_front') DESC, (kind = 'mockup') DESC, created_at ASC
    `)).rows as { design_id: string; thumb_key: string | null; preview_key: string | null }[];
    for (const f of fr) {
      thumbBy.set(f.design_id, {
        thumb: fileUrl(f.thumb_key) ?? fileUrl(f.preview_key),
        preview: fileUrl(f.preview_key) ?? fileUrl(f.thumb_key),
      });
    }
  }

  // ---- Dropdown filter (danh sách người/nền tảng đang có trong designs, theo scope) ----
  const people = (await db.execute(sql`
    SELECT DISTINCT u.id, u.full_name AS name, r.role
    FROM (
      SELECT seller_id AS uid, 'seller' AS role FROM designs d WHERE ${WHERE}
      UNION SELECT designer_id, 'designer' FROM designs d WHERE ${WHERE}
      UNION SELECT creator_id, 'creator' FROM designs d WHERE ${WHERE}
    ) r JOIN users u ON u.id = r.uid
    ORDER BY 3, 2
  `)).rows as { id: string; name: string; role: "seller" | "designer" | "creator" }[];

  return NextResponse.json({
    ok: true, total,
    // v176b · showMoney: tiền CHỈ trả về cho admin — ẩn từ API, không phải giấu trên UI.
    showMoney: isAdmin,
    rows: rows.map((r) => ({
      id: r.id,
      sku: "TLW-" + String(r.sku_code).padStart(4, "0"),
      title: r.title,
      platform: r.platform,
      // Sàn thực sự RA SALE trong khoảng đang xem (từ đơn hàng) — UI ưu tiên hiện cái này.
      salesPlatforms: (r.platforms ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      store: r.store,
      seller: r.seller, designer: r.designer, creator: r.creator,
      orders: Number(r.orders), qty: Number(r.qty),
      revenue: isAdmin ? Number(r.revenue) : null,
      lastOrder: r.last_order, createdAt: r.created_at,
      productLink: r.product_link,
      thumb: thumbBy.get(r.id)?.thumb ?? null,
      preview: thumbBy.get(r.id)?.preview ?? null,
    })),
    filters: {
      sellers: people.filter((p) => p.role === "seller"),
      designers: people.filter((p) => p.role === "designer"),
      creators: people.filter((p) => p.role === "creator"),
    },
  });
}
