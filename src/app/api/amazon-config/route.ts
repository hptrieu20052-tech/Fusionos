import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getSpConfig, getAmazonStoreId, mergeSpConfig, getAccessToken, spConfigured } from "@/lib/amazon-sp-api";

export const dynamic = "force-dynamic";

/**
 * SP-API config — v306: lưu theo TỪNG STORE Amazon (stores.api_credentials.spapi).
 * GET   ?storeId=  → trạng thái + giá trị (che bí mật: chỉ trả cờ đã-đặt). storeId trống = store Amazon mới nhất.
 * POST  { storeId?, region, marketplaceId, sellerId, lwaClientId, lwaClientSecret, refreshToken, test? }
 *        Lưu (bỏ trống secret = giữ nguyên). test=true → thử lấy access token.
 * Chỉ admin/level 2 products.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const storeId = req.nextUrl.searchParams.get("storeId") || undefined;
  const c = await getSpConfig(storeId);
  if (!c) return NextResponse.json({ ok: true, config: null, error: "Chưa có store Amazon — thêm store marketplace=Amazon ở mục Stores trước." });
  return NextResponse.json({
    ok: true,
    config: {
      storeId: c.storeId,
      region: c.region, marketplaceId: c.marketplaceId, sellerId: c.sellerId,
      lwaClientId: c.lwaClientId,
      hasSecret: !!c.lwaClientSecret, hasRefresh: !!c.refreshToken,
      configured: spConfigured(c), lastSyncAt: c.lastSyncAt,
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);

  const storeId = await getAmazonStoreId(typeof b?.storeId === "string" ? b.storeId : undefined);
  if (!storeId) return NextResponse.json({ ok: false, error: "Chưa có store Amazon — thêm store marketplace=Amazon ở mục Stores trước." }, { status: 400 });

  const patch: Record<string, string> = {};
  if (typeof b?.region === "string") patch.region = ["na", "eu", "fe"].includes(b.region) ? b.region : "na";
  if (typeof b?.marketplaceId === "string" && b.marketplaceId.trim()) patch.marketplaceId = b.marketplaceId.trim();
  if (typeof b?.sellerId === "string" && b.sellerId.trim()) patch.sellerId = b.sellerId.trim();
  if (typeof b?.lwaClientId === "string" && b.lwaClientId.trim()) patch.lwaClientId = b.lwaClientId.trim();
  // Secret/refresh: chỉ ghi đè khi có giá trị mới (bỏ trống = giữ nguyên)
  if (typeof b?.lwaClientSecret === "string" && b.lwaClientSecret.trim()) patch.lwaClientSecret = b.lwaClientSecret.trim();
  if (typeof b?.refreshToken === "string" && b.refreshToken.trim()) patch.refreshToken = b.refreshToken.trim();

  await mergeSpConfig(storeId, patch);

  // Test connection nếu yêu cầu
  if (b?.test) {
    const c = await getSpConfig(storeId);
    if (!spConfigured(c)) return NextResponse.json({ ok: true, saved: true, test: "incomplete", error: "Thiếu Client ID / Secret / Refresh Token / Seller ID" });
    try {
      await getAccessToken(c!);
      return NextResponse.json({ ok: true, saved: true, test: "ok" });
    } catch (e) {
      return NextResponse.json({ ok: true, saved: true, test: "fail", error: String((e as Error)?.message ?? e) });
    }
  }
  return NextResponse.json({ ok: true, saved: true, storeId });
}
