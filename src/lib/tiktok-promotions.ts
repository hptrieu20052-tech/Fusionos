// Helpers cho Marketing / Promotion (TikTok 202309). Build body Create Activity + Update Products,
// và simplify kết quả Search cho UI.
export type PromoType = "FIXED_PRICE" | "DIRECT_DISCOUNT" | "FLASHSALE" | "SHIPPING_DISCOUNT";
export type ProductLevel = "PRODUCT" | "SHOP";

export type PromoProductInput = { productId: string; dealPrice?: string; discount?: string };
export type ShippingInput = {
  benefit: "FREE_SHIPPING" | "DISCOUNT_SHIPPING_FEE";
  value?: string;                 // cần khi DISCOUNT_SHIPPING_FEE
  thresholdType?: "NO_THRESHOLD" | "MINIMAL_ITEM_QUANTITY" | "MINIMAL_ORDER_AMOUNT";
  thresholdValue?: string;
};

export type CreatePromoInput = {
  title: string;
  activityType: PromoType;
  productLevel: ProductLevel;
  beginTime: number;              // UNIX giây
  endTime: number;                // UNIX giây
  durationType?: "NORMAL" | "INDEFINITE";
  shipping?: ShippingInput;       // chỉ khi SHIPPING_DISCOUNT
};

// Body cho Create Promotion Activity.
export function buildCreateActivityBody(inp: CreatePromoInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: inp.title.slice(0, 50),
    activity_type: inp.activityType,
    product_level: inp.productLevel,
  };
  const indefinite = inp.durationType === "INDEFINITE" && inp.activityType === "SHIPPING_DISCOUNT";
  body.duration_type = indefinite ? "INDEFINITE" : "NORMAL";
  if (indefinite) { body.begin_time = 0; body.end_time = 0; }
  else { body.begin_time = inp.beginTime; body.end_time = inp.endTime; }

  if (inp.activityType === "SHIPPING_DISCOUNT" && inp.shipping) {
    const s = inp.shipping;
    const shipping_discount: Record<string, unknown> = {
      threshold_type: s.thresholdType ?? "NO_THRESHOLD",
      type: s.benefit,
      shipping_method: "ALL_SHIPPING_METHOD",
      inventory_type: "ALL",
      area_scope: { type: "WHOLE" },
    };
    if (s.thresholdType && s.thresholdType !== "NO_THRESHOLD" && s.thresholdValue) shipping_discount.threshold_value = s.thresholdValue;
    if (s.benefit === "DISCOUNT_SHIPPING_FEE" && s.value) shipping_discount.value = s.value;
    body.discount = { shipping_discount };
  }
  return body;
}

// Product lines cho Update Promotion Activity Products (product_level == PRODUCT).
// FIXED_PRICE/FLASHSALE → activity_price_amount; DIRECT_DISCOUNT → discount(%). quantity mặc định -1 (không giới hạn).
export function buildProductLines(activityType: PromoType, items: PromoProductInput[]): Record<string, unknown>[] {
  return items.map((it) => {
    const line: Record<string, unknown> = { id: it.productId, quantity_limit: -1, quantity_per_user: -1, skus: [] };
    if (activityType === "DIRECT_DISCOUNT") line.discount = String(it.discount ?? "");
    else if (activityType === "FIXED_PRICE" || activityType === "FLASHSALE") line.activity_price_amount = String(it.dealPrice ?? "");
    // SHIPPING_DISCOUNT product-level: chỉ cần id (không giá/discount)
    return line;
  });
}

// Rút gọn 1 activity từ Search cho UI.
export function simplifyActivity(a: Record<string, unknown>) {
  return {
    id: String(a.id ?? ""),
    title: String(a.title ?? ""),
    activityType: String(a.activity_type ?? ""),
    durationType: String(a.duration_type ?? ""),
    beginTime: Number(a.begin_time ?? 0),
    endTime: Number(a.end_time ?? 0),
    status: String(a.status ?? ""),
    productLevel: String(a.product_level ?? ""),
    createTime: Number(a.create_time ?? 0),
  };
}
