import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, desc, ilike, or } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { resolveStore } from "@/lib/tiktok-support";

export const dynamic = "force-dynamic";

// GET /api/tiktok/promotions/products?storeId=&kw= — product ACTIVATE của shop (từ bảng synced) để chọn vào promotion.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "marketing")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const storeId = url.searchParams.get("storeId") ?? "";
  const kw = (url.searchParams.get("kw") ?? "").trim();
  if (!storeId) return NextResponse.json({ ok: false, error: "storeId required" }, { status: 400 });
  const r = await resolveStore(session, storeId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });

  const conds = [eq(schema.tiktokProducts.storeId, storeId), eq(schema.tiktokProducts.status, "ACTIVATE")];
  if (kw) {
    const like = `%${kw}%`;
    const kwCond = or(ilike(schema.tiktokProducts.title, like), ilike(schema.tiktokProducts.tiktokProductId, like));
    if (kwCond) conds.push(kwCond);
  }
  const rows = await db.select({
    id: schema.tiktokProducts.tiktokProductId,
    title: schema.tiktokProducts.title,
    image: schema.tiktokProducts.mainImageUrl,
    price: schema.tiktokProducts.priceMin,
  }).from(schema.tiktokProducts).where(and(...conds)).orderBy(desc(schema.tiktokProducts.ttUpdateTime)).limit(200);

  return NextResponse.json({ ok: true, products: rows });
}
