import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.internalSku || !b?.fulfillerId || !b?.fulfillerSku || isNaN(Number(b.baseCost))) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  try {
    const [m] = await db.insert(schema.skuMappings).values({
      internalSku: b.internalSku.trim(), fulfillerId: b.fulfillerId, fulfillerSku: b.fulfillerSku.trim(),
      productType: b.productType || null, variant: b.variant || null,
      baseCost: Number(b.baseCost).toFixed(2), shipCost: Number(b.shipCost ?? 0).toFixed(2),
    }).returning();
    return NextResponse.json({ ok: true, mapping: m });
  } catch { return NextResponse.json({ ok: false, error: "mapping đã tồn tại" }, { status: 409 }); }
}

// PATCH { id, ...fields } — sửa 1 mapping
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (typeof b.internalSku === "string" && b.internalSku.trim()) patch.internalSku = b.internalSku.trim();
  if (typeof b.fulfillerSku === "string" && b.fulfillerSku.trim()) patch.fulfillerSku = b.fulfillerSku.trim();
  if ("variant" in b) patch.variant = b.variant || null;
  if ("fulfillerProduct" in b) patch.fulfillerProduct = b.fulfillerProduct || null;
  if (b.baseCost !== undefined && !isNaN(Number(b.baseCost))) patch.baseCost = Number(b.baseCost).toFixed(2);
  if (b.shipCost !== undefined && !isNaN(Number(b.shipCost))) patch.shipCost = Number(b.shipCost).toFixed(2);
  if (typeof b.active === "boolean") patch.active = b.active;
  const { eq } = await import("drizzle-orm");
  try {
    await db.update(schema.skuMappings).set(patch).where(eq(schema.skuMappings.id, b.id));
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ ok: false, error: "SKU nội bộ trùng với dòng khác" }, { status: 409 }); }
}

// DELETE { id }
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  const { eq } = await import("drizzle-orm");
  await db.delete(schema.skuMappings).where(eq(schema.skuMappings.id, b.id));
  return NextResponse.json({ ok: true });
}
