import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { resolveStore } from "@/lib/tiktok-support";
import { ttCreatePromotion, ttUpdatePromotionProducts } from "@/lib/tiktok-shop";
import { buildCreateActivityBody, buildProductLines, type PromoType, type ProductLevel, type PromoProductInput, type CreatePromoInput } from "@/lib/tiktok-promotions";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TYPES: PromoType[] = ["FIXED_PRICE", "DIRECT_DISCOUNT", "FLASHSALE", "SHIPPING_DISCOUNT"];

// POST /api/tiktok/promotions/create
// body: { storeId, title, activityType, beginTime, endTime, durationType?, productLevel?, shipping?, items? }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "marketing")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({} as Record<string, unknown>));

  const storeId = String(b.storeId ?? "");
  const title = String(b.title ?? "").trim();
  const activityType = b.activityType as PromoType;
  if (!storeId) return NextResponse.json({ ok: false, error: "storeId required" }, { status: 400 });
  if (!title) return NextResponse.json({ ok: false, error: "Title is required" }, { status: 400 });
  if (!TYPES.includes(activityType)) return NextResponse.json({ ok: false, error: "invalid activity type" }, { status: 400 });

  const isShipping = activityType === "SHIPPING_DISCOUNT";
  const productLevel: ProductLevel = isShipping ? ((b.productLevel === "PRODUCT" ? "PRODUCT" : "SHOP")) : "PRODUCT";
  const durationType = b.durationType === "INDEFINITE" ? "INDEFINITE" : "NORMAL";
  const beginTime = Number(b.beginTime ?? 0);
  const endTime = Number(b.endTime ?? 0);
  const nowSec = Math.floor(Date.now() / 1000);

  // Thời gian: bắt buộc cho NORMAL. begin phải ở tương lai; end > begin.
  if (durationType === "NORMAL") {
    if (!beginTime || !endTime) return NextResponse.json({ ok: false, error: "Start and end time are required" }, { status: 400 });
    if (beginTime <= nowSec) return NextResponse.json({ ok: false, error: "Start time must be in the future" }, { status: 400 });
    if (endTime <= beginTime) return NextResponse.json({ ok: false, error: "End time must be after start time" }, { status: 400 });
  }

  // Product lines (không cần khi SHIPPING_DISCOUNT ở cấp SHOP).
  const rawItems = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]) : [];
  const needProducts = !(isShipping && productLevel === "SHOP");
  const items: PromoProductInput[] = rawItems.map((it) => ({
    productId: String(it.productId ?? ""),
    dealPrice: it.dealPrice != null ? String(it.dealPrice) : undefined,
    discount: it.discount != null ? String(it.discount) : undefined,
  })).filter((it) => it.productId);

  if (needProducts) {
    if (!items.length) return NextResponse.json({ ok: false, error: "Select at least one product" }, { status: 400 });
    if (activityType === "DIRECT_DISCOUNT" && items.some((it) => !it.discount || Number(it.discount) <= 0)) return NextResponse.json({ ok: false, error: "Enter a discount % for every product" }, { status: 400 });
    if ((activityType === "FIXED_PRICE" || activityType === "FLASHSALE") && items.some((it) => !it.dealPrice || Number(it.dealPrice) <= 0)) return NextResponse.json({ ok: false, error: "Enter a deal price for every product" }, { status: 400 });
  }
  if (isShipping && b.shipping && (b.shipping as Record<string, unknown>).benefit === "DISCOUNT_SHIPPING_FEE") {
    const v = (b.shipping as Record<string, unknown>).value;
    if (!v || Number(v) <= 0) return NextResponse.json({ ok: false, error: "Enter the shipping discount amount" }, { status: 400 });
  }

  const r = await resolveStore(session, storeId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });

  const sh = (b.shipping ?? {}) as Record<string, unknown>;
  const thr = sh.thresholdType;
  const thresholdType = (thr === "MINIMAL_ITEM_QUANTITY" || thr === "MINIMAL_ORDER_AMOUNT") ? thr : "NO_THRESHOLD";
  const inp: CreatePromoInput = {
    title, activityType, productLevel, beginTime, endTime, durationType,
    shipping: isShipping ? {
      benefit: sh.benefit === "DISCOUNT_SHIPPING_FEE" ? "DISCOUNT_SHIPPING_FEE" : "FREE_SHIPPING",
      value: sh.value != null ? String(sh.value) : undefined,
      thresholdType,
      thresholdValue: sh.thresholdValue != null ? String(sh.thresholdValue) : undefined,
    } : undefined,
  };

  try {
    const created = await ttCreatePromotion(r.cfg, buildCreateActivityBody(inp));
    if (!created.activityId) return NextResponse.json({ ok: false, error: "Create failed (no activity id) " + JSON.stringify(created.raw).slice(0, 200) }, { status: 500 });
    let attached = 0;
    if (needProducts) {
      await ttUpdatePromotionProducts(r.cfg, created.activityId, buildProductLines(activityType, items));
      attached = items.length;
    }
    return NextResponse.json({ ok: true, activityId: created.activityId, status: created.status, attached });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 });
  }
}
