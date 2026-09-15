import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { wooApi, wooBaseUrl, wooConfigured, type WooCred } from "@/lib/woocommerce";

export const dynamic = "force-dynamic";

/**
 * POST /api/woocommerce/check { storeId }
 * Test kết nối: GET orders?per_page=1 (đúng scope Read cần cho sync). Trả tên site nếu lấy được.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "stores")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const storeId = String(b?.storeId ?? "").trim();
  if (!storeId) return NextResponse.json({ ok: false, error: "missing storeId" }, { status: 400 });

  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!s) return NextResponse.json({ ok: false, error: "store not found" }, { status: 404 });

  const cred = ((s.apiCredentials ?? {}) as Record<string, unknown>).woocommerce as WooCred | undefined;
  if (!wooConfigured(cred)) {
    return NextResponse.json({ ok: false, error: "Chưa nhập đủ Store URL + Consumer key + Consumer secret" }, { status: 400 });
  }

  try {
    const orders = await wooApi(cred!, "orders?per_page=1");
    const n = Array.isArray(orders) ? orders.length : 0;
    // Tên site (không cần auth): GET /wp-json — lỗi thì bỏ qua, không chặn check.
    let siteName = "";
    try {
      const res = await fetch(`${wooBaseUrl(cred!)}/wp-json`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) siteName = String(((await res.json()) as Record<string, unknown>).name ?? "");
    } catch { /* ignore */ }
    return NextResponse.json({
      ok: true,
      shopName: siteName || wooBaseUrl(cred!).replace(/^https?:\/\//, ""),
      domain: wooBaseUrl(cred!).replace(/^https?:\/\//, ""),
      sample: n, // 0 = kết nối OK nhưng chưa có đơn nào
    });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    let hint = "";
    if (msg.includes("404")) hint = " — Store URL sai, hoặc site chưa bật WooCommerce REST (permalink phải khác Plain).";
    else if (msg.includes("401") || msg.includes("403")) hint = " — Sai Consumer key/secret, hoặc key chưa có quyền Read.";
    return NextResponse.json({ ok: false, error: msg.slice(0, 250) + hint }, { status: 200 });
  }
}
