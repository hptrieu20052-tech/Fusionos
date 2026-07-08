import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, or, ilike, sql, asc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// GET /api/mappings/list?ff=<id>&q=<search>&page=1&size=50 — bảng SKU mapping phân trang (server-side)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const ff = sp.get("ff");
  if (!ff) return NextResponse.json({ ok: false, error: "missing ff" }, { status: 400 });
  const q = (sp.get("q") ?? "").trim();
  const page = Math.max(Number(sp.get("page")) || 1, 1);
  const size = Math.min(Math.max(Number(sp.get("size")) || 50, 1), 200);

  const conds = [eq(schema.skuMappings.fulfillerId, ff)];
  if (q) {
    const like = `%${q}%`;
    conds.push(
      or(
        ilike(schema.skuMappings.internalSku, like),
        ilike(schema.skuMappings.fulfillerSku, like),
        ilike(schema.skuMappings.variant, like),
        ilike(schema.skuMappings.fulfillerProduct, like),
      )!,
    );
  }
  const where = and(...conds);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.skuMappings).where(where);
  const rows = await db.select().from(schema.skuMappings).where(where)
    .orderBy(asc(schema.skuMappings.fulfillerProduct), asc(schema.skuMappings.fulfillerSku))
    .limit(size).offset((page - 1) * size);

  return NextResponse.json({ ok: true, rows, total, page, size });
}
