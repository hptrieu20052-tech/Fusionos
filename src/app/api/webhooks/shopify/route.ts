import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { verifyShopifyHmac, normalizeShopifyOrder, splitShopifyOrderBySeller, shopHost, webhookSecretOf, type ShopifyCred } from "@/lib/shopify";
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

  // orders/cancelled → đưa đơn (và các bản -CLONE-n của nó) về cancel
  const isCancel = topic.includes("cancel") || !!body.cancelled_at;

  try {
    const norm = normalizeShopifyOrder(body);
    if (isCancel && norm.externalId) {
      const base = norm.externalId.replace(/-CLONE-\d+$/, "");
      await db.update(schema.orders).set({ status: "cancel" as never, updatedAt: new Date() })
        .where(and(
          eq(schema.orders.platform, "shopify" as never),
          or(eq(schema.orders.externalId, base), like(schema.orders.externalId, `${base}-CLONE-%`)),
        ));
      return NextResponse.json({ ok: true, cancelled: base });
    }

    // PHÂN BỔ SELLER THEO SẢN PHẨM + TÁCH ĐƠN nếu giỏ trộn nhiều seller.
    // 1) Map product_id ↔ seller: khớp shopifyProductId của listing đã Push.
    const pids = Array.from(new Set((norm.items ?? [])
      .map((it) => String(it.listingId ?? "").replace(/\D/g, "")).filter(Boolean)));
    const pidToSeller = new Map<string, string>();
    if (pids.length) {
      const gids = pids.map((n) => `gid://shopify/Product/${n}`);
      const matched = await db.select({ gid: schema.etsyProducts.shopifyProductId, sellerId: schema.stores.sellerId })
        .from(schema.etsyProducts)
        .leftJoin(schema.stores, eq(schema.stores.id, schema.etsyProducts.storeId))
        .where(inArray(schema.etsyProducts.shopifyProductId, gids));
      for (const m of matched) { const n = String(m.gid ?? "").replace(/\D/g, ""); if (n && m.sellerId) pidToSeller.set(n, m.sellerId); }
    }
    // 2) Fallback cho item list tay (không map được): gán ADMIN đầu tiên để support/admin thấy mà fulfill.
    const [admin] = await db.select({ id: schema.users.id }).from(schema.users)
      .where(eq(schema.users.role, "admin")).orderBy(schema.users.createdAt).limit(1);
    const adminSellerId = admin?.id ?? store.sellerId ?? null;

    // v189 · ẢNH ITEM: webhook line_items của Shopify KHÔNG có ảnh — kéo từ Manage Products · Shopify
    // (bảng shopify_products đã có sẵn images của mọi listing, kể cả listing tạo tay).
    const pidToImg = new Map<string, string>();
    if (pids.length) {
      const gids = pids.map((n) => `gid://shopify/Product/${n}`);
      const prods = await db.select({ gid: schema.shopifyProducts.shopifyProductId, images: schema.shopifyProducts.images })
        .from(schema.shopifyProducts).where(inArray(schema.shopifyProducts.shopifyProductId, gids));
      for (const p of prods) {
        const n = String(p.gid ?? "").replace(/\D/g, "");
        const first = (Array.isArray(p.images) ? p.images as { src?: string }[] : [])[0];
        const src = String(first?.src ?? "").trim();
        if (n && /^https?:\/\//i.test(src)) pidToImg.set(n, src);
      }
    }

    // 3) Tách đơn theo seller (1 nhóm → 1 đơn; nhiều nhóm → đơn gốc + -CLONE-n, chia doanh thu theo tỉ lệ).
    const parts = splitShopifyOrderBySeller(body, (pid) => pidToSeller.get(pid) ?? null, adminSellerId);
    const out: Record<string, unknown>[] = [];
    for (const part of parts) {
      for (const it of part.order.items ?? []) {
        const n = String(it.listingId ?? "").replace(/\D/g, "");
        if (!it.imageUrl && n && pidToImg.has(n)) it.imageUrl = pidToImg.get(n);
      }
      const r = await insertEtsyOrders(
        { id: store.id, sellerId: part.sellerId, fx: store.fxRate, name: store.name },
        [part.order], "api", "shopify",
      );
      out.push({ externalId: part.order.externalId, seller: part.sellerId, ...r });
    }
    return NextResponse.json({ ok: true, parts: out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
