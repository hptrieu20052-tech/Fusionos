import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getPrintwayOrderDetail, extractPwCost } from "@/lib/printway-api";
import { pwCredOf } from "@/lib/printway-cost";
import { getMerchizeTracking, extractMerchizeTracking } from "@/lib/merchize";
import { getPrintifyOrder } from "@/lib/printify";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/fulfillment/ff-debug?id=<fulfillment_order_id | external_ff_id>
 *
 * Trả RAW response của nhà in cho ĐÚNG bản ghi đẩy đó + phần Fusion bóc ra được.
 * Dùng khi cost/tracking không về: so `raw` với `parsed` là biết field nào đặt tên khác.
 * Chỉ admin (hoặc level 2 module fulfillment).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "admin" && (await levelOf(session, "fulfillment")) < 2)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "thiếu ?id=<ffoId hoặc mã đơn nhà in>" }, { status: 400 });

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const [ffo] = await db.select().from(schema.fulfillmentOrders)
    .where(isUuid ? eq(schema.fulfillmentOrders.id, id) : eq(schema.fulfillmentOrders.externalFfId, id))
    .limit(1);
  if (!ffo) return NextResponse.json({ ok: false, error: `không tìm thấy bản ghi đẩy nào khớp ${id}` }, { status: 404 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, ffo.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller not found" }, { status: 404 });

  const name = ff.name.toLowerCase();
  const cred = (ff.credentials ?? {}) as Record<string, string>;
  const apiKey = cred.apiKey || cred.accessToken || cred.apiToken;
  const fusion = {
    fulfiller: ff.name, externalFfId: ffo.externalFfId, status: ffo.status,
    cost: ffo.cost, baseCost: ffo.baseCost, shipCost: ffo.shipCost, extraFee: ffo.extraFee,
    tracking: ffo.trackingNumber,
  };

  try {
    if (name.includes("printway")) {
      const c = pwCredOf(ff);
      if (!c) return NextResponse.json({ ok: false, error: "Printway: thiếu access token" }, { status: 400 });
      const [ord] = await db.select({ label: schema.orders.orderLabel, ext: schema.orders.externalId })
        .from(schema.orders).where(eq(schema.orders.id, ffo.orderId)).limit(1);
      const orderName = (ord?.label?.trim() || ord?.ext || "") || undefined;
      const pwOrderId = ffo.externalFfId && /^PW/i.test(ffo.externalFfId) ? ffo.externalFfId : undefined;
      const raw = await getPrintwayOrderDetail(c, { pwOrderId, orderName });
      return NextResponse.json({ ok: true, fusion, sentAs: { pw_order_id: pwOrderId ?? null, order_name: orderName ?? null }, parsed: extractPwCost(raw), raw });
    }

    if (name.includes("merchize")) {
      if (!apiKey) return NextResponse.json({ ok: false, error: "Merchize: thiếu API Key" }, { status: 400 });
      const baseUrl = ff.apiEndpoint?.trim() || "";
      if (!baseUrl) return NextResponse.json({ ok: false, error: "Merchize: thiếu Base URL" }, { status: 400 });
      const raw = await getMerchizeTracking(baseUrl, apiKey, { code: ffo.externalFfId ?? "" });
      return NextResponse.json({ ok: true, fusion, sentAs: { code: ffo.externalFfId }, parsed: extractMerchizeTracking(raw), raw });
    }

    if (name.includes("printify")) {
      const token = cred.apiKey || cred.apiToken;
      const shopId = (ff.credentials as Record<string, unknown>)?.shopId as string | number | undefined;
      if (!token || !shopId) return NextResponse.json({ ok: false, error: "Printify: thiếu token / shopId" }, { status: 400 });
      const raw = await getPrintifyOrder(token, shopId, ffo.externalFfId ?? "");
      return NextResponse.json({ ok: true, fusion, sentAs: { shopId, orderId: ffo.externalFfId }, raw });
    }

    return NextResponse.json({ ok: false, error: `Chưa hỗ trợ debug cho nhà in "${ff.name}"`, fusion }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, fusion, error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}
