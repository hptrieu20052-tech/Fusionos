import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { shopifyApi, shopHost, type ShopifyCred } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/**
 * POST /api/shopify/check  { storeId }
 * Test kết nối: đổi token client_credentials + GET shop.json → trả tên shop, domain thật.
 * Dùng để xác nhận shopDomain/clientId/clientSecret nhập đúng trước khi đăng ký webhook.
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

  const cred = (s.apiCredentials ?? {}) as ShopifyCred;
  if (!shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
    return NextResponse.json({ ok: false, error: "Chưa nhập đủ Shop domain + Client ID + Client Secret" }, { status: 400 });
  }

  try {
    const r = await shopifyApi(cred, "shop.json");
    const shop = (r.shop ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      ok: true,
      shopName: String(shop.name ?? ""),
      myshopifyDomain: String(shop.myshopify_domain ?? ""),
      email: String(shop.email ?? ""),
      currency: String(shop.currency ?? ""),
    });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // Gợi ý lỗi hay gặp: 404 = sai shopDomain; 401 = sai secret / thiếu scope
    let hint = "";
    if (msg.includes("404")) hint = " — Shop domain sai. Dùng dạng xxx.myshopify.com (không phải talewix.com).";
    else if (msg.includes("401") || msg.includes("403")) hint = " — Sai Client Secret hoặc version app chưa có scope read_orders.";
    return NextResponse.json({ ok: false, error: msg.slice(0, 250) + hint }, { status: 200 });
  }
}
