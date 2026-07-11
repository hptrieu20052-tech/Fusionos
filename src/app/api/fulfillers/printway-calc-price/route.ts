import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { calcPrintwayPrice } from "@/lib/printway-api";
import { usStateAbbr } from "@/lib/fulfillers";
import { toISO2 } from "@/lib/printify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId, country, state, lines: [{ mappingId, qty }] }
 * → tính giá THẬT từ Printway (/order/calculate-price) cho Estimated cost trên form đẩy.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "fulfillment")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId || !Array.isArray(b.lines) || !b.lines.length) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as Record<string, string>;
  const accessToken = c.apiKey || c.accessToken || c.apiToken;
  if (!accessToken) return NextResponse.json({ ok: false, error: "no token" }, { status: 400 });

  const mapIds = (b.lines as { mappingId: string }[]).map((l) => l.mappingId).filter(Boolean);
  const maps = await db.select().from(schema.skuMappings)
    .where(and(eq(schema.skuMappings.fulfillerId, ff.id), inArray(schema.skuMappings.id, mapIds)));
  const items = (b.lines as { mappingId: string; qty: number }[]).map((l) => {
    const m = maps.find((x) => x.id === l.mappingId);
    if (!m) return null;
    return { item_sku: m.fulfillerSku, quantity: Math.max(1, Number(l.qty) || 1) };
  }).filter(Boolean) as { item_sku: string; quantity: number }[];
  if (!items.length) return NextResponse.json({ ok: false, error: "no valid lines" }, { status: 400 });

  try {
    const r = await calcPrintwayPrice({ accessToken, endpoint: ff.apiEndpoint }, {
      countryCode: toISO2(String(b.country || "United States")),
      provinceCode: usStateAbbr(String(b.state || "")),
      items,
    });
    return NextResponse.json({ ok: true, total: r.total, base: r.base, ship: r.ship, raw: r.raw });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
