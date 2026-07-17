import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { hasAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

// POST /api/fulfillers/reveal { id } → trả giá trị THẬT của credential (để bấm con mắt xem lại).
// Gate: settings ≥ 2 + action fulfillment.credentials (giống lúc sửa).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!(await hasAction(session, "fulfillment.credentials"))) return NextResponse.json({ ok: false, error: "forbidden: credentials" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  const [f] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.id)).limit(1);
  if (!f) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const c = (f.credentials ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    ok: true,
    apiEndpoint: f.apiEndpoint ?? "",
    webhookSecret: f.webhookSecret ?? "",
    apiKey: c.apiKey != null ? String(c.apiKey) : "",
    shopId: c.shopId != null ? String(c.shopId) : "",
    identifier: c.identifier != null ? String(c.identifier) : "",
    sheetId: c.sheetId != null ? String(c.sheetId) : "",
    tab: c.tab != null ? String(c.tab) : "",
    warehouse: c.warehouse != null ? String(c.warehouse) : "",
    carrier: c.carrier != null ? String(c.carrier) : "",
  });
}
