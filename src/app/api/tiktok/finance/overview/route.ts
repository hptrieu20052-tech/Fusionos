import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { storeOwnerScopeIds } from "@/lib/scope";
import { readTtCfg } from "@/lib/tiktok-shop";

export const dynamic = "force-dynamic";

/**
 * v438 · GET /api/tiktok/finance/overview?from=&to=&status=&storeId=&seller=
 * ĐỌC TỪ DB (bảng tiktok_statements do cron /api/cron/tiktok-finance đồng bộ nền 30–60p/lần)
 * → trả ngay lập tức, số ổn định, không gọi API TikTok lúc xem.
 * Kèm lastSyncAt (mốc đồng bộ CŨ NHẤT trong các shop) để UI hiện "cập nhật lúc...".
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "financeTiktok")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const storeId = (sp.get("storeId") ?? "").trim();
  const sellerId = (sp.get("seller") ?? "").trim();
  const status = (sp.get("status") ?? "").trim();
  const toEpoch = (d: string | null) => (d ? Math.floor(new Date(d).getTime() / 1000) : undefined);
  const timeGe = toEpoch(sp.get("from"));
  const timeLt = toEpoch(sp.get("to"));

  const scopeIds = await storeOwnerScopeIds(session);
  const storeConds = [eq(schema.stores.marketplace, "tiktok")];
  if (scopeIds) storeConds.push(inArray(schema.stores.sellerId, scopeIds));
  if (/^[0-9a-f-]{36}$/i.test(storeId)) storeConds.push(eq(schema.stores.id, storeId));
  if (/^[0-9a-f-]{36}$/i.test(sellerId)) storeConds.push(eq(schema.stores.sellerId, sellerId));
  const stores = (await db.select({ id: schema.stores.id, name: schema.stores.name, cred: schema.stores.apiCredentials, health: schema.stores.health })
    .from(schema.stores).where(and(...storeConds)))
    .filter((s) => readTtCfg((s.cred ?? null) as Record<string, string> | null).refreshToken);
  if (!stores.length) return NextResponse.json({ ok: false, error: "no connected TikTok store in scope" }, { status: 400 });
  const nameById = new Map(stores.map((s) => [s.id, s.name]));

  // Mốc đồng bộ cũ nhất giữa các shop — 0 = có shop chưa chạy cron lần nào.
  const syncTimes = stores.map((s) => Number(((s.health ?? {}) as Record<string, unknown>).ttFinanceSyncAt ?? 0));
  const lastSyncAt = syncTimes.length ? Math.min(...syncTimes) : 0;

  const conds = [inArray(schema.tiktokStatements.storeId, stores.map((s) => s.id))];
  if (status) conds.push(eq(schema.tiktokStatements.status, status));
  if (timeGe) conds.push(gte(schema.tiktokStatements.statementTime, timeGe));
  if (timeLt) conds.push(lt(schema.tiktokStatements.statementTime, timeLt));
  const rows = await db.select().from(schema.tiktokStatements)
    .where(and(...conds)).orderBy(desc(schema.tiktokStatements.statementTime)).limit(20000);

  const statements = rows.map((r) => ({
    storeId: r.storeId, storeName: nameById.get(r.storeId) ?? "—",
    id: r.statementId, time: r.statementTime, currency: r.currency,
    settlement: r.settlement ?? "", revenue: r.revenue ?? "", fee: r.fee ?? "",
    adjustment: r.adjustment ?? "", status: r.status, paymentId: r.paymentId, paidTime: r.paidTime,
  }));

  return NextResponse.json({ ok: true, statements, storeCount: stores.length, lastSyncAt, errors: [] });
}
