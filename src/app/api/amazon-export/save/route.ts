import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * POST /api/amazon-export/save { id, amazonTitle, amazonBullets, amazonDesc }
 *
 * Lưu bộ copy AMAZON của 1 listing — đường RIÊNG như feed-save: KHÔNG set dirty,
 * KHÔNG push lên Shopify. 3 field này chỉ nằm trong FUSION và chỉ đi ra ngoài
 * qua nút Export Amazon flat file.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const [row] = await db.select({ id: schema.shopifyProducts.id, seller: schema.stores.sellerId })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(eq(schema.shopifyProducts.id, id)).limit(1);
  if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!row.seller || !scopeIds.includes(row.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const amazonTitle = String(b?.amazonTitle ?? "").trim().slice(0, 250);
  const amazonDesc = String(b?.amazonDesc ?? "").trim().slice(0, 2500);
  const amazonBullets = (Array.isArray(b?.amazonBullets) ? b.amazonBullets : [])
    .map((x: unknown) => String(x ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, 5);

  // Cảnh báo mềm (không chặn lưu) để UI hiện — Amazon suppress title >200, bullets thiếu thì listing yếu.
  const warns: string[] = [];
  if (amazonTitle && (amazonTitle.length < 140 || amazonTitle.length > 200)) warns.push(`title ${amazonTitle.length} chars (target 150-200)`);
  if (amazonBullets.length > 0 && amazonBullets.length < 5) warns.push(`only ${amazonBullets.length}/5 bullets`);

  await db.update(schema.shopifyProducts)
    .set({ amazonTitle: amazonTitle || null, amazonBullets: amazonBullets.length ? amazonBullets : null, amazonDesc: amazonDesc || null, amazonAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.shopifyProducts.id, id));

  return NextResponse.json({ ok: true, warn: warns.join(" · ") || undefined });
}
