import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { ttGetValidCfg, ttGetOrderDetail, ttGetShippingProviders } from "@/lib/tiktok-shop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/tiktok/ff-diag?orderId=<internal uuid>
 * CHẨN ĐOÁN READ-ONLY — không đẩy gì lên TikTok. Lấy Order Detail thật + danh sách shipping provider
 * để xác minh shape (package_id, shipping_type, provider_id...) trước khi viết ship_package / get-label.
 * Gửi toàn bộ JSON này cho trợ lý là đủ để ráp API đẩy tracking / lấy label cho đúng.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "orders")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const orderId = (req.nextUrl.searchParams.get("orderId") ?? "").trim();
  if (!orderId) return NextResponse.json({ ok: false, error: "missing orderId (internal uuid OR TikTok order number)" }, { status: 400 });

  // Nhận cả UUID nội bộ lẫn số đơn TikTok (externalId) — copy thẳng #5774... vào là được.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
  const [ord] = await db.select({
    id: schema.orders.id, externalId: schema.orders.externalId, storeId: schema.orders.storeId,
    platform: schema.orders.platform, shippingType: schema.orders.shippingType,
  }).from(schema.orders).where(isUuid ? eq(schema.orders.id, orderId) : eq(schema.orders.externalId, orderId)).limit(1);
  if (!ord) return NextResponse.json({ ok: false, error: "order not found" }, { status: 404 });
  if (ord.platform !== "tiktok") return NextResponse.json({ ok: false, error: `not a TikTok order (platform=${ord.platform})` }, { status: 400 });
  if (!ord.storeId) return NextResponse.json({ ok: false, error: "order has no store" }, { status: 400 });

  const [st] = await db.select({ c: schema.stores.apiCredentials }).from(schema.stores).where(eq(schema.stores.id, ord.storeId)).limit(1);

  try {
    const cfg = await ttGetValidCfg(ord.storeId, (st?.c ?? null) as Record<string, string> | null);
    // Order Detail (nguồn chính: package_id, shipping_type, provider)
    let orderDetail: unknown = null, orderDetailError: string | null = null;
    try { orderDetail = await ttGetOrderDetail(cfg, [ord.externalId]); }
    catch (e) { orderDetailError = String((e as Error)?.message ?? e).slice(0, 200); }
    // Shipping providers (để map carrier → provider_id)
    const providers = await ttGetShippingProviders(cfg);

    return NextResponse.json({
      ok: true,
      order: { internalId: ord.id, externalId: ord.externalId, shippingTypeStored: ord.shippingType },
      shopId: cfg.shopId, shopName: cfg.shopName,
      orderDetail, orderDetailError,
      providers,
      hint: "Gửi toàn bộ JSON này cho trợ lý. Cần: packages[].id, shipping_type/fulfillment_type, và provider list.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
