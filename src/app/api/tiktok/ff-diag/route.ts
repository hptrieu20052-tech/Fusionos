import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { ttGetValidCfg, ttGetOrderDetail, ttGetShippingProviders, ttProbe, ttSearchPackages, ttGetShippingDocument } from "@/lib/tiktok-shop";

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

    // PROBE NĂNG LỰC: các API cần cho push tracking + get label. code=40006 = app KHÔNG có quyền.
    const ext = ord.externalId;
    const capabilities = await Promise.all([
      ttProbe(cfg, "POST", "/fulfillment/202309/packages/search", { page_size: "10" }, { order_ids: [ext] }),
      ttProbe(cfg, "GET", `/fulfillment/202309/orders/${ext}/packages`, {}),
      ttProbe(cfg, "GET", "/logistics/202309/shipping_providers", {}),
      ttProbe(cfg, "GET", "/logistics/202309/warehouses", {}),
    ]);

    // PROBE WRITE (AN TOÀN — body rỗng/thiếu field): chỉ để LỘ QUYỀN.
    //  - code=40006 "no schema found" → app KHÔNG có quyền lệnh này (không dùng được qua theyourlist).
    //  - code khác (thiếu tham số / validation) → app CÓ quyền, chỉ là body chưa đủ → dựng thật được.
    // KHÔNG tạo shipment, KHÔNG bị charge vì body cố tình không hợp lệ.
    const writeProbes = await Promise.all([
      ttProbe(cfg, "POST", `/fulfillment/202309/orders/${ext}/packages`, {}, {}),
      ttProbe(cfg, "POST", "/fulfillment/202309/packages/rts", {}, {}),
      ttProbe(cfg, "POST", `/fulfillment/202309/orders/${ext}/packages/deliver`, {}, {}),
    ]);

    // ===== TEST THẬT CHUỖI GET-LABEL =====
    // 1) tìm package của đơn; 2) nếu có package → thử lấy shipping_document (label).
    let packages: unknown = null, packagesError: string | null = null;
    let labelTest: unknown = null;
    try {
      const pkgs = await ttSearchPackages(cfg, ext);
      packages = pkgs;
      const pkgId = pkgs.length ? String((pkgs[0] as Record<string, unknown>).id ?? (pkgs[0] as Record<string, unknown>).package_id ?? "") : "";
      if (pkgId) {
        // Lấy CẢ 2 loại để xác minh cái nào là nhãn USPS thật (cái nào là packing slip).
        const types = ["SHIPPING_LABEL", "PACKING_SLIP", "SHIPPING_LABEL_AND_PACKING_SLIP"];
        const docs: Record<string, unknown> = {};
        for (const dt of types) {
          try { docs[dt] = await ttGetShippingDocument(cfg, pkgId, { docType: dt }); }
          catch (e) { docs[dt] = { error: String((e as Error)?.message ?? e).slice(0, 160) }; }
        }
        labelTest = { packageId: pkgId, docsByType: docs };
      } else {
        labelTest = { note: "Đơn chưa có package — cần Arrange shipment trên TikTok trước rồi chạy lại." };
      }
    } catch (e) { packagesError = String((e as Error)?.message ?? e).slice(0, 200); }

    return NextResponse.json({
      ok: true,
      order: { internalId: ord.id, externalId: ord.externalId, shippingTypeStored: ord.shippingType },
      shopId: cfg.shopId, shopName: cfg.shopName,
      orderDetail, orderDetailError,
      packages, packagesError, labelTest,
      providers,
      capabilities,
      writeProbes,
      hint: "writeProbes: code=40006 = app KHÔNG có quyền Arrange (WRITE). Code khác (thiếu field) = CÓ quyền.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
