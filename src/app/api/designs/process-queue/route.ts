import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, or, eq, lt, ne, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { processFile, MAX_ATTEMPTS } from "@/lib/process-image";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Hàng đợi xử lý thumbnail — chạy bằng Vercel Cron (mỗi phút) hoặc admin gọi tay.
 * Gom tối đa N file đang "uploaded" hoặc "failed" (còn lượt thử) và xử lý TUẦN TỰ
 * (mỗi lần 1 file) để không tràn RAM khi gặp file nặng.
 */
async function run(limit: number) {
  const rows = await db.select({ id: schema.designFiles.id })
    .from(schema.designFiles)
    .where(and(
      ne(schema.designFiles.kind, "video"),
      or(
        eq(schema.designFiles.processingStatus, "uploaded"),
        and(eq(schema.designFiles.processingStatus, "failed"), lt(schema.designFiles.processAttempts, MAX_ATTEMPTS)),
      ),
    ))
    .orderBy(sql`process_attempts ASC, created_at ASC`)
    .limit(limit);

  const results: { id: string; ok: boolean }[] = [];
  for (const r of rows) {
    const res = await processFile(r.id); // tuần tự để giới hạn bộ nhớ
    results.push({ id: r.id, ok: res.ok });
  }
  const done = results.filter((r) => r.ok).length;
  return { picked: rows.length, done, failed: results.length - done };
}

// GET — Vercel Cron (Authorization: Bearer CRON_SECRET) hoặc admin đăng nhập
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const cronOk = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!cronOk) {
    const session = await getSession();
    if (session?.role !== "admin") return NextResponse.json({ ok: false }, { status: 403 });
  }
  const limit = Math.min(10, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 5)));
  const out = await run(limit);
  return NextResponse.json({ ok: true, ...out });
}
