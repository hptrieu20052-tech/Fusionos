import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { ttGetStatements } from "@/lib/tiktok-shop";
import { resolveStore } from "@/lib/tiktok-support";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/tiktok/finance/statements?storeId=&from=&to=&status=&pageToken=
// Danh sách payout/quyết toán (Get Statements 202309). scope seller.finance.info.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "financeTiktok")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const storeId = sp.get("storeId");
  if (!storeId) return NextResponse.json({ ok: false, error: "missing storeId" }, { status: 400 });
  const r = await resolveStore(session, storeId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });

  const from = sp.get("from");
  const to = sp.get("to");
  const status = sp.get("status") || undefined; // PAID | PROCESSING | FAILED
  const pageToken = sp.get("pageToken") || undefined;
  const toEpoch = (d: string | null) => (d ? Math.floor(new Date(d).getTime() / 1000) : undefined);

  try {
    const { statements, nextPageToken } = await ttGetStatements(r.cfg, {
      timeGe: toEpoch(from), timeLt: toEpoch(to), paymentStatus: status, pageToken, pageSize: 50, sortOrder: "DESC",
    });
    const rows = statements.map((s) => ({
      id: String(s.id ?? ""),
      time: Number(s.statement_time ?? 0),
      currency: String(s.currency ?? ""),
      settlement: String(s.settlement_amount ?? ""),
      revenue: String(s.revenue_amount ?? ""),
      fee: String(s.fee_amount ?? ""),
      adjustment: String(s.adjustment_amount ?? ""),
      status: String(s.payment_status ?? ""),
      paymentId: String(s.payment_id ?? ""),
      paidTime: Number(s.payment_time ?? 0),
    }));
    return NextResponse.json({ ok: true, statements: rows, nextPageToken, storeName: r.store.name });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
