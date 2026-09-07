import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { asc, eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { readTtCfg, ttGetStatements, ttGetValidCfg } from "@/lib/tiktok-shop";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * v438 · GET|POST /api/cron/tiktok-finance — đồng bộ NỀN statement TikTok vào bảng
 * tiktok_statements. Gọi định kỳ 30–60 phút (cùng chỗ đang gọi /api/cron/tick).
 *
 * Cách chạy:
 *  - Mỗi vòng kéo cửa sổ 60 NGÀY gần nhất cho từng shop (upsert → PROCESSING đổi
 *    thành PAID được cập nhật; statement cũ hơn 60 ngày đã chốt, không đổi nữa).
 *  - Xếp shop theo lần đồng bộ cũ nhất trước (marker health.ttFinanceSyncAt trong stores.health);
 *    ngân sách 270s — hết giờ thì shop còn lại sang vòng sau (rotation, không shop nào bị bỏ đói).
 *  - Chống rate limit như v437: lô 3 shop, nghỉ giữa trang, retry 429 tối đa 3 lần.
 *
 * Xác thực: Bearer CRON_SECRET | ?key=CRON_SECRET | header x-vercel-cron | session admin.
 */
export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const isVercelCron = !!req.headers.get("x-vercel-cron");
  let ok = isVercelCron || (!!secret && (auth === `Bearer ${secret}` || key === secret));
  if (!ok) {
    const session = await getSession();               // cho admin bấm "Sync now" từ UI
    ok = !!session && session.role === "admin";
  }
  if (!ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const started = Date.now();
  const deadline = started + 270000;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const is429 = (e: unknown) => { const m = String((e as Error)?.message ?? e); return m.includes("429") || m.includes("36009002") || m.toLowerCase().includes("rate limit"); };
  const withRetry = async <T,>(fn: () => Promise<T>): Promise<T> => {
    for (let a = 0; ; a++) {
      try { return await fn(); }
      catch (e) { if (a >= 3 || !is429(e)) throw e; await sleep(1200 * (a + 1)); }
    }
  };

  // Shop TikTok đã connect, cũ nhất đồng bộ trước (health.ttFinanceSyncAt).
  const all = (await db.select({ id: schema.stores.id, name: schema.stores.name, cred: schema.stores.apiCredentials, health: schema.stores.health })
    .from(schema.stores).where(eq(schema.stores.marketplace, "tiktok")).orderBy(asc(schema.stores.name)))
    .filter((s) => readTtCfg((s.cred ?? null) as Record<string, string> | null).refreshToken)
    .sort((a, b) => {
      const ta = Number(((a.health ?? {}) as Record<string, unknown>).ttFinanceSyncAt ?? 0);
      const tb = Number(((b.health ?? {}) as Record<string, unknown>).ttFinanceSyncAt ?? 0);
      return ta - tb;
    });

  const timeGe = Math.floor(Date.now() / 1000) - 60 * 86400;   // cửa sổ 60 ngày
  const results: { store: string; upserts?: number; error?: string; skipped?: boolean }[] = [];

  const num = (v: unknown): string | null => { const n = Number(v); return isFinite(n) ? n.toFixed(2) : null; };
  const syncStore = async (s: typeof all[number]) => {
    try {
      const cfg = await ttGetValidCfg(s.id, (s.cred ?? null) as Record<string, string> | null);
      let pageToken: string | undefined;
      let upserts = 0;
      for (let page = 0; page < 20; page++) {   // 20 trang × 50 = 1000 statement/shop — thừa cho 60 ngày
        const { statements, nextPageToken } = await withRetry(() =>
          ttGetStatements(cfg, { timeGe, pageToken, pageSize: 50, sortOrder: "DESC" }));
        if (statements.length) {
          const values = statements.map((st) => ({
            storeId: s.id,
            statementId: String(st.id ?? ""),
            statementTime: Number(st.statement_time ?? 0),
            currency: String(st.currency ?? ""),
            settlement: num(st.settlement_amount),
            revenue: num(st.revenue_amount),
            fee: num(st.fee_amount),
            adjustment: num(st.adjustment_amount),
            status: String(st.payment_status ?? ""),
            paymentId: String(st.payment_id ?? ""),
            paidTime: Number(st.payment_time ?? 0),
            updatedAt: new Date(),
          })).filter((v) => v.statementId);
          if (values.length) {
            await db.insert(schema.tiktokStatements).values(values).onConflictDoUpdate({
              target: [schema.tiktokStatements.storeId, schema.tiktokStatements.statementId],
              set: {
                status: sql`excluded.status`, paidTime: sql`excluded.paid_time`,
                settlement: sql`excluded.settlement`, revenue: sql`excluded.revenue`,
                fee: sql`excluded.fee`, adjustment: sql`excluded.adjustment`,
                paymentId: sql`excluded.payment_id`, updatedAt: sql`now()`,
              },
            });
            upserts += values.length;
          }
        }
        if (!nextPageToken) break;
        pageToken = nextPageToken;
        await sleep(250);
      }
      // Marker lần đồng bộ — merge vào stores.health (jsonb), không cần migration.
      await db.execute(sql`UPDATE stores SET health = coalesce(health,'{}'::jsonb) || jsonb_build_object('ttFinanceSyncAt', ${Date.now()}) WHERE id = ${s.id}`);
      results.push({ store: s.name, upserts });
    } catch (e) {
      results.push({ store: s.name, error: String((e as Error)?.message ?? e).slice(0, 180) });
    }
  };

  const BATCH = 3;
  for (let i = 0; i < all.length; i += BATCH) {
    if (Date.now() > deadline) { for (const s of all.slice(i)) results.push({ store: s.name, skipped: true }); break; }
    await Promise.all(all.slice(i, i + BATCH).map(syncStore));
    if (i + BATCH < all.length) await sleep(300);
  }

  return NextResponse.json({ ok: true, stores: all.length, tookMs: Date.now() - started, results });
}
