import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { shopbaseApi, shopbaseHost, shopbaseConfigured, type ShopBaseCred } from "@/lib/shopbase";

export const dynamic = "force-dynamic";

/**
 * POST /api/shopbase/check { storeId }
 * Test kết nối: Basic auth + GET shop.json → trả tên shop + domain thật. Xác nhận creds đúng trước khi sync.
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

  const cred = ((s.apiCredentials ?? {}) as Record<string, unknown>).shopbase as ShopBaseCred | undefined;
  if (!shopbaseConfigured(cred ?? null)) {
    return NextResponse.json({ ok: false, error: "Chưa nhập đủ Subdomain + API key + Password" }, { status: 400 });
  }

  try {
    const r = await shopbaseApi(cred!, "shop.json");
    const shop = (r.shop ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      ok: true,
      shopName: String(shop.name ?? ""),
      domain: String(shop.domain ?? shop.myshopify_domain ?? shopbaseHost(cred!)),
      email: String(shop.email ?? ""),
      currency: String(shop.currency ?? ""),
    });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    let hint = "";
    if (msg.includes("404")) hint = " — Subdomain sai. Dùng dạng {store}.onshopbase.com (hoặc chỉ {store}).";
    else if (msg.includes("401") || msg.includes("403")) hint = " — Sai API key / Password, hoặc private app thiếu quyền Admin API.";
    return NextResponse.json({ ok: false, error: msg.slice(0, 250) + hint }, { status: 200 });
  }
}
