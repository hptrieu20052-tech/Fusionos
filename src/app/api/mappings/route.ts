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
  } catch { return NextResponse.json({ ok: false, error: "mapping already exists" }, { status: 409 }); }
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
  if ("pfBlueprintId" in b) patch.pfBlueprintId = b.pfBlueprintId != null ? Number(b.pfBlueprintId) : null;
  if ("pfProviderId" in b) patch.pfProviderId = b.pfProviderId != null ? Number(b.pfProviderId) : null;
  if ("pfVariantId" in b) patch.pfVariantId = b.pfVariantId != null ? Number(b.pfVariantId) : null;
  if (typeof b.active === "boolean") patch.active = b.active;
  const { eq } = await import("drizzle-orm");
  try {
    await db.update(schema.skuMappings).set(patch).where(eq(schema.skuMappings.id, b.id));
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ ok: false, error: "Internal SKU duplicates another row" }, { status: 409 }); }
}

// DELETE { id }
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const { eq, and, inArray } = await import("drizzle-orm");

  // Xóa hàng loạt theo sản phẩm (nhiều variant) hoặc xóa TẤT CẢ của 1 nhà fulfill
  if (b?.fulfillerId && (Array.isArray(b?.products) || b?.all)) {
    const conds = [eq(schema.skuMappings.fulfillerId, b.fulfillerId)];
    if (!b.all) {
      const products = (b.products as unknown[]).map(String).filter(Boolean);
      if (!products.length) return NextResponse.json({ ok: false, error: "no product selected" }, { status: 400 });
      conds.push(inArray(schema.skuMappings.fulfillerProduct, products));
    }
    const res = await db.delete(schema.skuMappings).where(and(...conds)).returning({ id: schema.skuMappings.id });
    return NextResponse.json({ ok: true, deleted: res.length });
  }

  if (!b?.id) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  await db.delete(schema.skuMappings).where(eq(schema.skuMappings.id, b.id));
  return NextResponse.json({ ok: true });
}
