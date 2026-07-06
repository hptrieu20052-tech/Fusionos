import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// GET ?fulfillerId=... — xuất CSV các đơn NEW đã mapping đủ SKU với fulfiller này (mở được bằng Excel)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "fulfillment")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const fid = req.nextUrl.searchParams.get("fulfillerId");
  if (!fid) return NextResponse.json({ ok: false, error: "fulfillerId required" }, { status: 400 });
  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, fid)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const orders = await db.select().from(schema.orders).where(eq(schema.orders.status, "new")).limit(500);
  const ids = orders.map((o) => o.id);
  const items = ids.length ? await db.select().from(schema.orderItems).where(inArray(schema.orderItems.orderId, ids)) : [];
  const maps = await db.select().from(schema.skuMappings).where(and(eq(schema.skuMappings.fulfillerId, fid), eq(schema.skuMappings.active, true)));

  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["Order ID", "Buyer Name", "Address 1", "Address 2", "City", "State", "Zip", "Country", "Fulfiller SKU", "Qty", "Base Cost"];
  const lines = [header.join(",")];

  for (const o of orders) {
    const its = items.filter((i) => i.orderId === o.id);
    if (!its.length || !its.every((i) => i.internalSku && maps.find((m) => m.internalSku === i.internalSku))) continue;
    for (const it of its) {
      const m = maps.find((x) => x.internalSku === it.internalSku)!;
      lines.push([
        esc(o.externalId), esc(`${o.buyerFirst ?? ""} ${o.buyerLast ?? ""}`.trim()),
        esc(o.addr1), esc(o.addr2), esc(o.city), esc(o.state), esc(o.zip), esc(o.country),
        esc(m.fulfillerSku), it.qty, Number(m.baseCost).toFixed(2),
      ].join(","));
    }
  }

  return new NextResponse("\uFEFF" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fulfill-${ff.name}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
