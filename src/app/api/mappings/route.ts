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
