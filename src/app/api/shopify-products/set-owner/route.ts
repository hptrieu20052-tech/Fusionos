import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { adminUserIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * v592 · POST /api/shopify-products/set-owner { ids: string[], userId?: string }
 * Admin gán CHỦ LISTING (created_by) cho listing Shopify. Dùng cho listing tạo TAY trên Shopify
 * trước khi có FUSION: created_by = NULL nên seller filter + Spend by seller (Meta Ads Center)
 * rơi vào "(unassigned)". Chỉ ghi DB FUSION — KHÔNG đụng Shopify, không đổi listing.
 * userId rỗng → xoá owner (về NULL / unassigned).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden: admin only" }, { status: 403 });

  const b = await req.json().catch(() => null) as { ids?: unknown[]; userId?: string } | null;
  const ids = (Array.isArray(b?.ids) ? b!.ids! : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });

  const raw = String(b?.userId ?? "").trim();
  const userId = /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
  if (raw && !userId) return NextResponse.json({ ok: false, error: "userId must be a user id (or empty to clear the owner)" }, { status: 400 });

  // Gán cho user CÓ THẬT thôi — id rác thì báo luôn thay vì ghi bừa vào DB.
  if (userId) {
    const u = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!u.length) return NextResponse.json({ ok: false, error: "user not found" }, { status: 400 });
  }

  const r = await db.update(schema.shopifyProducts)
    .set({ createdBy: userId, updatedAt: new Date() })
    .where(inArray(schema.shopifyProducts.id, ids))
    .returning({ id: schema.shopifyProducts.id });

  // v597 · GÁN LẠI ĐƠN CŨ: webhook mất map seller (vd seller xoá store Etsy nguồn) thì đơn rơi về
  // ADMIN (fallback). Gán owner xong → đơn Shopify của những listing này đang đứng tên admin/trống
  // chuyển về chủ mới luôn. Đơn đã gán TAY cho seller khác thì không đụng.
  let ordersMoved = 0;
  if (userId) {
    try {
      const prods = await db.select({ gid: schema.shopifyProducts.shopifyProductId }).from(schema.shopifyProducts).where(inArray(schema.shopifyProducts.id, ids));
      const pids = Array.from(new Set(prods.map((p) => String(p.gid ?? "").replace(/\D/g, "")).filter(Boolean)));
      if (pids.length && userId) {
        const admins = await adminUserIds();
        const hit = (await db.execute(sql`
          SELECT DISTINCT o.id, o.seller_id AS sid FROM orders o
          JOIN order_items oi ON oi.order_id = o.id
          WHERE o.platform = 'shopify'
            AND regexp_replace(coalesce(oi.etsy_listing_id, ''), '[^0-9]', '', 'g') IN (${sql.join(pids.map((p) => sql`${p}`), sql`, `)})
        `)).rows as { id: string; sid: string | null }[];
        const move = hit.filter((o) => !o.sid || admins.includes(o.sid)).map((o) => o.id);
        if (move.length) {
          await db.update(schema.orders)
            .set({ sellerId: userId, sellerAtOrder: userId, updatedAt: new Date() })
            .where(inArray(schema.orders.id, move));
          ordersMoved = move.length;
        }
      }
    } catch { /* đơn là phụ — lỗi không chặn việc gán owner listing */ }
  }

  return NextResponse.json({ ok: true, updated: r.length, ordersMoved });
}
