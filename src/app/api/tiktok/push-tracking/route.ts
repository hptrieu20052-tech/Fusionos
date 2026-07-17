import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { pushTiktokTrackingForOrder } from "@/lib/tiktok-tracking";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET|POST /api/tiktok/push-tracking
//  - ?orderId=<uuid>  → đẩy tracking 1 đơn TikTok Seller-Shipping lên TikTok Shop.
//  - ?all=1           → BACKFILL: quét mọi đơn TikTok Seller đã có tracking mà CHƯA đẩy (window 90 ngày, cap 500).
// Dùng để xử lý đơn đã có tracking TRƯỚC khi deploy bản auto-push (webhook không bắn lại nên phải quét tay/định kỳ).
async function run(orderId: string | null, all: boolean) {
  if (orderId) {
    const r = await pushTiktokTrackingForOrder(orderId);
    return { ok: r.ok, tried: 1, pushed: r.pushed, errors: r.errors, reason: r.reason };
  }
  if (all) {
    const rows = (await db.execute(sql`
      SELECT DISTINCT o.id FROM orders o
      JOIN fulfillment_orders fo ON fo.order_id = o.id
      WHERE o.platform='tiktok' AND o.shipping_type='SELLER'
        AND fo.tracking_number IS NOT NULL AND fo.tiktok_tracking_pushed_at IS NULL
        AND o.status NOT IN ('cancel','trash')
        AND o.ordered_at > now() - interval '90 days'
      ORDER BY o.ordered_at DESC
      LIMIT 500
    `)).rows as { id: string }[];
    let pushed = 0, tried = 0; const errors: string[] = [];
    const deadline = Date.now() + 52000; // chừa ~8s trước maxDuration; idempotent nên còn dư quét tiếp lần sau
    for (const r of rows) {
      if (Date.now() > deadline) break;
      tried++;
      try { const res = await pushTiktokTrackingForOrder(r.id); pushed += res.pushed; if (res.errors.length) errors.push(...res.errors); }
      catch (e) { errors.push(String((e as Error)?.message ?? e).slice(0, 160)); }
    }
    return { ok: true, tried, remaining: rows.length - tried, pushed, errors: errors.slice(0, 30) };
  }
  return { ok: false, error: "cần ?orderId=<id> hoặc ?all=1" };
}

// Cho phép: (a) đăng nhập Fusion có quyền fulfillment ≥ 2, HOẶC (b) CRON_SECRET (để lịch chạy NGOÀI gọi định kỳ).
async function authed(req: NextRequest): Promise<boolean> {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (secret && (key === secret || auth === `Bearer ${secret}`)) return true;
  const session = await getSession();
  return !!session && (await levelOf(session, "fulfillment")) >= 2;
}

export async function POST(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const sp = req.nextUrl.searchParams;
  const res = await run(b?.orderId ? String(b.orderId) : sp.get("orderId"), b?.all === true || b?.all === "1" || sp.get("all") === "1");
  return NextResponse.json(res, { status: res.ok === false && res.error ? 400 : 200 });
}

// GET tiện mở thẳng trên trình duyệt (đã đăng nhập) hoặc lịch ngoài: /api/tiktok/push-tracking?all=1&key=<CRON_SECRET>
export async function GET(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const res = await run(sp.get("orderId"), sp.get("all") === "1" || sp.get("all") === "true");
  return NextResponse.json(res, { status: res.ok === false && res.error ? 400 : 200 });
}
