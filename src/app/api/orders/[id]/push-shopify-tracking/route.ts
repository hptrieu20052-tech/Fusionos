import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { pushShopifyTrackingForOrder } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/orders/[id]/push-shopify-tracking
 * Đẩy TAY tracking ngược lên Shopify (tạo fulfillment) cho 1 đơn — nút "Push to Shopify" ở Order Hub.
 * Dùng khi đơn Shopify đã có tracking trong FusionOS nhưng Shopify vẫn "Unfulfilled":
 *   · lần auto đẩy trước trượt (vd store thiếu scope write_merchant_managed_fulfillment_orders),
 *   · hoặc tracking nhập tay sau khi webhook đã chạy.
 * Trả về lỗi CỤ THỂ để biết vì sao (khác im lặng như trước).
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "fulfillment")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const res = await pushShopifyTrackingForOrder(params.id);
  return NextResponse.json(res);
}
