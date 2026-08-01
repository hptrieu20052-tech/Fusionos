import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * POST /api/shopify-products/set-template { ids, templateId | null }
 * CHỈ gán template (nguồn facts cho AI Optimize + 3 tab) cho listing trong FUSION.
 * KHÔNG đụng Shopify, KHÔNG đổi mô tả đang có — mô tả chỉ đổi khi chạy lại AI Optimize rồi Push.
 * templateId = null → bỏ gán, quay lại tự khớp theo Product type.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 500);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  const raw = b?.templateId == null ? "" : String(b.templateId);
  const templateId = /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;

  const rows = await db.select({ id: schema.shopifyProducts.id, storeId: schema.shopifyProducts.storeId, seller: schema.stores.sellerId })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  let targets = rows;
  if (templateId) {
    const [tpl] = await db.select().from(schema.shopifyTemplates).where(eq(schema.shopifyTemplates.id, templateId)).limit(1);
    if (!tpl) return NextResponse.json({ ok: false, error: "template not found" }, { status: 404 });
    targets = rows.filter((r) => r.storeId === tpl.storeId); // template gắn theo store
  }
  const okIds = targets.map((r) => r.id);
  if (!okIds.length) return NextResponse.json({ ok: false, error: "no product in this template's store" }, { status: 400 });

  await db.update(schema.shopifyProducts).set({ templateId, updatedAt: new Date() }).where(inArray(schema.shopifyProducts.id, okIds));
  return NextResponse.json({ ok: true, done: okIds.length, skipped: rows.length - okIds.length });
}
