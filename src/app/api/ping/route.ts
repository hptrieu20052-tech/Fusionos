import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/ping — endpoint siêu nhẹ để "hâm nóng" lambda + kết nối Supabase.
 * Client gọi khi user quay lại tab sau khi idle (visibilitychange) → đến lúc user
 * thật sự click thì function đã ấm, không còn cold start 2–5s.
 * Cũng có thể trỏ cron-job.org vào đây (mỗi 5') để giữ ấm liên tục.
 */
export async function GET() {
  let dbOk = true;
  try { await db.execute(sql`select 1`); } catch { dbOk = false; }
  return NextResponse.json({ ok: true, db: dbOk, t: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
