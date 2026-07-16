import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || (await levelOf(session, "orders")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const rows = await db.select().from(schema.tiktokProducts).orderBy(desc(schema.tiktokProducts.ttUpdateTime)).limit(1000);
  return NextResponse.json({ ok: true, rows: JSON.parse(JSON.stringify(rows)) });
}
