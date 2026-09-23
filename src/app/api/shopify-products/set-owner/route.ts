import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";

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

  return NextResponse.json({ ok: true, updated: r.length });
}
