import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { pushTiktokTrackingForOrder } from "@/lib/tiktok-tracking";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/tiktok/track-diag[?run=1][&store=<tên chứa>]
 *
 * READ-ONLY mặc định: liệt kê MỌI đơn TikTok có tracking mà CHƯA đẩy lên TikTok, gom theo STORE
 * + theo giá trị shipping_type đang lưu. Trả lời thẳng câu "vì sao shop này đẩy được, shop kia không".
 *
 * ?run=1 → thử đẩy thật (idempotent, tối đa 30 đơn) và trả về LÝ DO từng đơn trượt —
 * cái mà cron nuốt mất vì catch rỗng.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "admin" && (await levelOf(session, "orders")) < 2)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const run = req.nextUrl.searchParams.get("run") === "1";
  const storeQ = (req.nextUrl.searchParams.get("store") ?? "").trim().toLowerCase();

  // 1) Bức tranh tổng: đơn TikTok có tracking, chưa đẩy — theo store × shipping_type đang lưu.
  const backlog = (await db.execute(sql`
    SELECT s.name AS store,
           COALESCE(o.shipping_type, '(null)') AS shipping_type,
           count(DISTINCT o.id)::int AS orders,
           min(o.ordered_at) AS oldest,
           max(o.ordered_at) AS newest
    FROM orders o
    JOIN fulfillment_orders fo ON fo.order_id = o.id
    LEFT JOIN stores s ON s.id = o.store_id
    WHERE o.platform='tiktok'
      AND fo.tracking_number IS NOT NULL
      AND fo.tiktok_tracking_pushed_at IS NULL
      AND o.status NOT IN ('cancel','trash')
      AND o.ordered_at > now() - interval '90 days'
    GROUP BY 1,2 ORDER BY 3 DESC
  `)).rows;

  // 2) Đối chứng: đơn ĐÃ đẩy thành công — store nào từng chạy được thì token/scope chắc chắn ổn.
  const pushedOk = (await db.execute(sql`
    SELECT s.name AS store, count(*)::int AS pushed, max(fo.tiktok_tracking_pushed_at) AS last_push
    FROM fulfillment_orders fo
    JOIN orders o ON o.id = fo.order_id
    LEFT JOIN stores s ON s.id = o.store_id
    WHERE o.platform='tiktok' AND fo.tiktok_tracking_pushed_at IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC
  `)).rows;

  // 3) Phân bố shipping_type toàn bộ đơn TikTok — thấy ngay store nào bị lưu NULL/chuỗi lạ.
  const typeMix = (await db.execute(sql`
    SELECT s.name AS store, COALESCE(o.shipping_type,'(null)') AS shipping_type, count(*)::int AS orders
    FROM orders o LEFT JOIN stores s ON s.id = o.store_id
    WHERE o.platform='tiktok' AND o.ordered_at > now() - interval '90 days'
    GROUP BY 1,2 ORDER BY 1,3 DESC
  `)).rows;

  // 4) Lỗi đang lưu của lần đẩy gần nhất (v163) — xem được KHÔNG cần chạy ?run=1.
  const lastErrors = (await db.execute(sql`
    SELECT s.name AS store, fo.tiktok_push_error AS error,
           count(*)::int AS orders, max(fo.tiktok_push_attempts)::int AS max_attempts,
           min(fo.tiktok_push_next_at) AS next_try
    FROM fulfillment_orders fo
    JOIN orders o ON o.id = fo.order_id
    LEFT JOIN stores s ON s.id = o.store_id
    WHERE o.platform='tiktok' AND fo.tiktok_tracking_pushed_at IS NULL
      AND fo.tiktok_push_error IS NOT NULL
    GROUP BY 1,2 ORDER BY 3 DESC LIMIT 40
  `)).rows;

  let attempts: { order: string; store: string | null; storedType: string | null; pushed: number; reason?: string; errors?: string[] }[] | undefined;
  if (run) {
    // BUG CŨ: lọc theo ?store= chạy trong JS SAU khi SQL đã LIMIT 30 → lọc theo tên shop
    // thường trả về rỗng dù shop đó tồn đọng cả chục đơn. Giờ lọc thẳng trong SQL.
    const rows = (await db.execute(sql`
      SELECT DISTINCT o.id, o.external_id, s.name AS store, o.shipping_type, o.ordered_at
      FROM orders o
      JOIN fulfillment_orders fo ON fo.order_id = o.id
      LEFT JOIN stores s ON s.id = o.store_id
      WHERE o.platform='tiktok'
        AND (o.shipping_type IS DISTINCT FROM 'TIKTOK')
        AND fo.tracking_number IS NOT NULL AND fo.tiktok_tracking_pushed_at IS NULL
        AND o.status NOT IN ('cancel','trash')
        AND o.ordered_at > now() - interval '90 days'
        AND (${storeQ} = '' OR lower(coalesce(s.name,'')) LIKE ${"%" + storeQ + "%"})
      ORDER BY o.ordered_at DESC LIMIT 30
    `)).rows as { id: string; external_id: string; store: string | null; shipping_type: string | null }[];
    const started = Date.now();
    attempts = [];
    for (const r of rows) {
      if (Date.now() - started > 45000) { attempts.push({ order: "…", store: null, storedType: null, pushed: 0, reason: "dừng vì hết thời gian, chạy lại để tiếp" }); break; }
      try {
        const res = await pushTiktokTrackingForOrder(r.id);
        attempts.push({ order: r.external_id, store: r.store, storedType: r.shipping_type, pushed: res.pushed, reason: res.reason, errors: res.errors?.length ? res.errors : undefined });
      } catch (e) {
        attempts.push({ order: r.external_id, store: r.store, storedType: r.shipping_type, pushed: 0, errors: [String((e as Error)?.message ?? e).slice(0, 200)] });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    backlog, pushedOk, typeMix, lastErrors, attempts,
    hint: "backlog = đơn có tracking chưa đẩy, gom theo store. lastErrors = lý do lần đẩy gần nhất (cần MIGRATION v163). Thêm ?run=1 để thử đẩy thật, ?run=1&store=<tên> để chỉ chạy 1 shop.",
  });
}
