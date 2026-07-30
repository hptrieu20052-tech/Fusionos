import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { verifyShopifyHmac, normalizeShopifyOrder, shopHost, webhookSecretOf, type ShopifyCred } from "@/lib/shopify";
import { insertEtsyOrders } from "@/lib/ingest-etsy";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/shopify — nhận webhook Shopify (orders/create, orders/paid).
 * Header: X-Shopify-Shop-Domain (định danh store) · X-Shopify-Hmac-Sha256 (chữ ký) · X-Shopify-Topic.
 * Khớp store theo shop domain → verify HMAC bằng webhookSecret của store → ingest như Etsy/TikTok.
 * Trả 200 nhanh (Shopify retry nếu != 2xx). Chỉ xử orders/create|paid.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text(); // PHẢI đọc raw để verify HMAC (không parse trước)
  const shopDomain = (req.headers.get("x-shopify-shop-domain") ?? "").trim().toLowerCase();
  const hmac = req.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = (req.headers.get("x-shopify-topic") ?? "").toLowerCase();

  // Chỉ quan tâm đơn mới / đã thanh toán
  if (!topic.startsWith("orders/")) return NextResponse.json({ ok: true, skipped: "topic " + topic });

  // Tìm store Shopify khớp shop domain (nếu chỉ có 1 store shopify thì dùng luôn store đó)
  const shopifyStores = await db.select().from(schema.stores).where(eq(schema.stores.marketplace, "shopify"));
  if (!shopifyStores.length) return NextResponse.json({ ok: false, error: "no shopify store configured" }, { status: 202 });
  const store = shopifyStores.find((s) => shopHost((s.apiCredentials ?? {}) as ShopifyCred).toLowerCase() === shopDomain)
    ?? (shopifyStores.length === 1 ? shopifyStores[0] : undefined);
  if (!store) return NextResponse.json({ ok: false, error: "no matching shopify store for " + shopDomain }, { status: 202 });

  // Verify HMAC: app Dev Dashboard ký bằng clientSecret; legacy dùng webhookSecret. Không có secret → từ chối.
  const cred = (store.apiCredentials ?? {}) as ShopifyCred;
  const secret = webhookSecretOf(cred);
  if (!secret || !verifyShopifyHmac(raw, hmac, secret)) {
    return NextResponse.json({ ok: false, error: "invalid hmac" }, { status: 401 });
  }

  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  if (!body) return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });

  // orders/cancelled → đưa đơn về cancel (không tạo mới)
  const isCancel = topic.includes("cancel") || !!body.cancelled_at;

  try {
    const norm = normalizeShopifyOrder(body);
    if (isCancel && norm.externalId) {
      await db.update(schema.orders).set({ status: "cancel" as never, updatedAt: new Date() })
        .where(and(eq(schema.orders.platform, "shopify" as never), eq(schema.orders.externalId, norm.externalId)));
      return NextResponse.json({ ok: true, cancelled: norm.externalId });
    }
    // insertEtsyOrders tự bắn Telegram cho đơn mới (notifyNewSales bên trong) → không gọi lại ở đây.
    const r = await insertEtsyOrders(
      { id: store.id, sellerId: store.sellerId, fx: store.fxRate, name: store.name },
      [norm], "api", "shopify",
    );
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
