import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listVariants } from "@/lib/printify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId, blueprintId, providerId, blueprintTitle }
 * Kéo TOÀN BỘ variant của 1 blueprint + nhà in Printify về thành SKU mapping sẵn "recipe"
 * (pfBlueprintId/pfProviderId/pfVariantId) — đẩy đơn khỏi cần cấu hình ⚙ In từng cái.
 * Auto ghim để hiện luôn trong form tạo đơn (giống Merchize).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const bp = Number(b?.blueprintId), pv = Number(b?.providerId);
  if (!b?.fulfillerId || !Number.isInteger(bp) || !Number.isInteger(pv)) return NextResponse.json({ ok: false, error: "thiếu blueprint/nhà in" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller không tồn tại" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; apiToken?: string };
  const token = c.apiKey || c.apiToken;
  if (!token) return NextResponse.json({ ok: false, error: "Chưa cấu hình token Printify" }, { status: 400 });

  let vs;
  try { vs = await listVariants(token, bp, pv); }
  catch (e) { return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 502 }); }
  if (!vs.length) return NextResponse.json({ ok: false, error: "Blueprint/nhà in này không có variant" }, { status: 400 });

  const title = (String(b.blueprintTitle ?? "").trim() || `Blueprint ${bp}`).slice(0, 200);
  const rows = vs.map((v) => ({
    internalSku: `PF-${bp}-${pv}-${v.id}`,
    fulfillerId: ff.id,
    fulfillerSku: `PF-${bp}-${pv}-${v.id}`,
    productType: title.slice(0, 120),
    fulfillerProduct: title,
    variant: (v.title ?? "").slice(0, 120) || null,
    pfBlueprintId: bp, pfProviderId: pv, pfVariantId: v.id,
    baseCost: "0", shipCost: "0",
    pinned: true,
  }));

  const res = await db.insert(schema.skuMappings).values(rows).onConflictDoNothing().returning({ id: schema.skuMappings.id });
  const created = res.length;
  return NextResponse.json({ ok: true, created, skipped: rows.length - created, total: rows.length });
}
