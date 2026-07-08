import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listVariants, listProviders } from "@/lib/printify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId, blueprintId, providerId?, allProviders?, blueprintTitle }
 * Kéo variant của 1 blueprint Printify về thành SKU mapping (recipe pfBlueprintId/pfProviderId/pfVariantId).
 * - allProviders=true → kéo TẤT CẢ nhà in của blueprint (mỗi nhà in 1 bộ SKU), gắn tên nhà in vào SP.
 * - else → chỉ nhà in providerId.
 * Auto ghim để hiện trong form tạo đơn.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const bp = Number(b?.blueprintId);
  const allProviders = !!b?.allProviders;
  const pv = Number(b?.providerId);
  if (!b?.fulfillerId || !Number.isInteger(bp) || (!allProviders && !Number.isInteger(pv))) {
    return NextResponse.json({ ok: false, error: "thiếu blueprint/nhà in" }, { status: 400 });
  }

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller không tồn tại" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; apiToken?: string };
  const token = c.apiKey || c.apiToken;
  if (!token) return NextResponse.json({ ok: false, error: "Chưa cấu hình token Printify" }, { status: 400 });

  const title = (String(b.blueprintTitle ?? "").trim() || `Blueprint ${bp}`).slice(0, 120);

  // Danh sách nhà in cần kéo + tên
  let providers: { id: number; title: string }[];
  try {
    const all = await listProviders(token, bp);
    providers = allProviders ? all : all.filter((p) => p.id === pv);
    if (!providers.length && !allProviders) providers = [{ id: pv, title: `Nhà in ${pv}` }];
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 502 });
  }
  if (!providers.length) return NextResponse.json({ ok: false, error: "Blueprint không có nhà in" }, { status: 400 });

  const start = Date.now();
  type Row = typeof schema.skuMappings.$inferInsert;
  const rows: Row[] = [];
  let providersDone = 0, providersFailed = 0;
  for (const p of providers) {
    if (Date.now() - start > 45000) break; // ngân sách thời gian
    try {
      const vs = await listVariants(token, bp, p.id);
      for (const v of vs) {
        rows.push({
          internalSku: `PF-${bp}-${p.id}-${v.id}`,
          fulfillerId: ff.id,
          fulfillerSku: `PF-${bp}-${p.id}-${v.id}`,
          productType: title,
          fulfillerProduct: `${title} · ${p.title}`.slice(0, 200),
          variant: (v.title ?? "").slice(0, 120) || null,
          pfBlueprintId: bp, pfProviderId: p.id, pfVariantId: v.id,
          baseCost: "0", shipCost: "0",
          pinned: true,
        });
      }
      providersDone++;
    } catch { providersFailed++; }
  }
  if (!rows.length) return NextResponse.json({ ok: false, error: "Không kéo được variant nào" }, { status: 400 });

  // Chèn theo lô để tránh payload quá lớn
  let created = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await db.insert(schema.skuMappings).values(chunk).onConflictDoNothing().returning({ id: schema.skuMappings.id });
    created += res.length;
  }
  return NextResponse.json({
    ok: true, created, skipped: rows.length - created, total: rows.length,
    providers: providers.length, providersDone, providersFailed,
    done: providersDone + providersFailed >= providers.length,
  });
}
