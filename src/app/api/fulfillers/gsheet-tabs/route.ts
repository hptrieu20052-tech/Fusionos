import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listSheetTabs } from "@/lib/gsheet";

export const dynamic = "force-dynamic";

// POST { fulfillerId } → { ok, tabs:[...] } — đọc list tab của Sheet gắn với fulfiller Google Sheet.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "orders")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });
  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller not found" }, { status: 404 });
  const cred = (ff.credentials ?? {}) as { kind?: string; sheetId?: string };
  if (cred.kind !== "gsheet" || !cred.sheetId) return NextResponse.json({ ok: false, error: "not a Google Sheet fulfiller" }, { status: 400 });
  try {
    const tabs = await listSheetTabs(cred.sheetId);
    return NextResponse.json({ ok: true, tabs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
