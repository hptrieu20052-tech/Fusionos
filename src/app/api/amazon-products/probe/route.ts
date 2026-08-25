import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getSpConfig, spConfigured, getListing, getListingData, getAmazonStoreId } from "@/lib/amazon-sp-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/amazon-products/probe?sku=TLW-0079-PARENT-AMZ[&storeId=]
 *
 * Chẩn đoán: Amazon Listings Items API trả GÌ cho 1 SKU (còn/đã xóa?). Chỉ đọc, luôn JSON.
 * Mở thẳng trên trình duyệt (đang đăng nhập) để xem raw.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    const sku = (req.nextUrl.searchParams.get("sku") ?? "").trim();
    if (!sku) return NextResponse.json({ ok: false, error: "?sku= required" }, { status: 200 });

    const storeId = await getAmazonStoreId(req.nextUrl.searchParams.get("storeId") ?? undefined);
    const cfg = await getSpConfig(storeId ?? undefined);
    if (!spConfigured(cfg)) return NextResponse.json({ ok: false, error: "SP-API not configured" }, { status: 200 });

    // 1) getListing (summaries) — null = 404, throw = lỗi khác
    let listing: { result: "null(404)" | "found" | "error"; asin?: string | null; status?: string; error?: string };
    try {
      const info = await getListing(cfg!, sku);
      listing = info ? { result: "found", asin: info.asin, status: info.status } : { result: "null(404)" };
    } catch (e) { listing = { result: "error", error: String((e as Error)?.message ?? e).slice(0, 200) }; }

    // 2) getListingData (summaries+attributes+relationships) — xem status + cấu trúc VARIATION chi tiết
    let data: {
      result: "null(404)" | "found" | "error"; asin?: string | null; status?: string; productType?: string; error?: string;
      variation_theme?: unknown; parentage_level?: unknown; child_parent_sku_relationship?: unknown; relationships?: unknown;
    };
    try {
      const d = await getListingData(cfg!, sku, "summaries,attributes,relationships");
      if (d) {
        const a = d.attributes || {};
        data = {
          result: "found", asin: d.asin, status: d.status || "(empty)", productType: d.productType,
          variation_theme: a.variation_theme, parentage_level: a.parentage_level,
          child_parent_sku_relationship: a.child_parent_sku_relationship,
          relationships: d.relationships,
        };
      } else data = { result: "null(404)" };
    } catch (e) { data = { result: "error", error: String((e as Error)?.message ?? e).slice(0, 200) }; }

    return NextResponse.json({ ok: true, sku, listing, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 220) }, { status: 200 });
  }
}
