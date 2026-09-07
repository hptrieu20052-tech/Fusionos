import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { storeOwnerScopeIds } from "@/lib/scope";
import { readTtCfg, ttGetStatements, ttGetValidCfg } from "@/lib/tiktok-shop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * v436 · GET /api/tiktok/finance/overview?from=&to=&status=&storeId=&seller=
 * Kéo statement của TẤT CẢ shop TikTok trong scope (hoặc 1 shop nếu truyền storeId)
 * trong 1 lần gọi — mỗi shop phân trang tới 6 trang (300 dòng) để không vượt 60s.
 * Trả rows kèm storeId/storeName; client tự gộp Paid/Processing/Failed + theo ngày.
 * LƯU Ý: "On hold" của Seller Center (tiền đơn CHƯA tới kỳ quyết toán) không có trong
 * Finance API — chỉ có statement đã quyết toán (PAID/PROCESSING/FAILED).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "financeTiktok")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const storeId = (sp.get("storeId") ?? "").trim();
  const sellerId = (sp.get("seller") ?? "").trim();
  const status = sp.get("status") || undefined;
  const toEpoch = (d: string | null) => (d ? Math.floor(new Date(d).getTime() / 1000) : undefined);
  const timeGe = toEpoch(sp.get("from"));
  const timeLt = toEpoch(sp.get("to"));

  const scopeIds = await storeOwnerScopeIds(session);
  const conds = [eq(schema.stores.marketplace, "tiktok")];
  if (scopeIds) conds.push(inArray(schema.stores.sellerId, scopeIds));
  if (/^[0-9a-f-]{36}$/i.test(storeId)) conds.push(eq(schema.stores.id, storeId));
  if (/^[0-9a-f-]{36}$/i.test(sellerId)) conds.push(eq(schema.stores.sellerId, sellerId));
  const stores = (await db.select({ id: schema.stores.id, name: schema.stores.name, cred: schema.stores.apiCredentials })
    .from(schema.stores).where(and(...conds)))
    .filter((s) => readTtCfg((s.cred ?? null) as Record<string, string> | null).refreshToken);
  if (!stores.length) return NextResponse.json({ ok: false, error: "no connected TikTok store in scope" }, { status: 400 });

  type Row = { storeId: string; storeName: string; id: string; time: number; currency: string; settlement: string; revenue: string; fee: string; adjustment: string; status: string; paymentId: string; paidTime: number };
  const rows: Row[] = [];
  const errors: { store: string; error: string }[] = [];

  await Promise.all(stores.map(async (s) => {
    try {
      const cfg = await ttGetValidCfg(s.id, (s.cred ?? null) as Record<string, string> | null);
      let pageToken: string | undefined;
      for (let page = 0; page < 6; page++) {   // trần 6 trang × 50 = 300 statement/shop/lần
        const { statements, nextPageToken } = await ttGetStatements(cfg, { timeGe, timeLt, paymentStatus: status, pageToken, pageSize: 50, sortOrder: "DESC" });
        for (const st of statements) rows.push({
          storeId: s.id, storeName: s.name,
          id: String(st.id ?? ""), time: Number(st.statement_time ?? 0),
          currency: String(st.currency ?? ""), settlement: String(st.settlement_amount ?? ""),
          revenue: String(st.revenue_amount ?? ""), fee: String(st.fee_amount ?? ""),
          adjustment: String(st.adjustment_amount ?? ""), status: String(st.payment_status ?? ""),
          paymentId: String(st.payment_id ?? ""), paidTime: Number(st.payment_time ?? 0),
        });
        if (!nextPageToken) break;
        pageToken = nextPageToken;
      }
    } catch (e) {
      errors.push({ store: s.name, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }));

  rows.sort((a, b) => b.time - a.time);
  return NextResponse.json({ ok: true, statements: rows, storeCount: stores.length, errors });
}
