import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db, schema } from "@/lib/db";
import { eq, and, ne, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// GET — chi tiết 1 store cho modal edit (che giá trị credentials, chỉ trả tên field)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "stores")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, params.id)).limit(1);
  if (!s) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const cred = (s.apiCredentials ?? {}) as Record<string, string>;
  // Trạng thái kết nối Etsy API (không lộ secret/token)
  const etsy = {
    hasKeystring: !!cred.etsy_keystring,
    keystring: cred.etsy_keystring || "",
    connected: !!cred.etsy_refresh_token && !!cred.etsy_shop_id,
    shopId: cred.etsy_shop_id || "",
  };
  // Trạng thái kết nối TikTok Shop API
  const tiktok = {
    hasApp: !!cred.tiktok_app_key,
    appKey: cred.tiktok_app_key || "",
    authLink: cred.tiktok_auth_link || "",
    connected: !!cred.tiktok_refresh_token && !!cred.tiktok_shop_cipher,
    shopId: cred.tiktok_shop_id || "",
    shopName: cred.tiktok_shop_name || "",
  };
  // Trạng thái kết nối Shopify (không lộ secret)
  const shopify = {
    shopDomain: cred.shopDomain || "",
    hasApp: !!cred.shopDomain && !!(cred.adminToken || (cred.clientId && cred.clientSecret)),
    clientId: cred.clientId || "",
  };
  // Ẩn các key etsy_*/tiktok_*/shopify khỏi credentialKeys hiển thị (đã có mục API riêng)
  const SHOPIFY_KEYS = ["shopDomain", "clientId", "clientSecret", "adminToken", "webhookSecret"];
  const shownKeys = Object.keys(cred).filter((k) => !k.startsWith("etsy_") && !k.startsWith("tiktok_") && !SHOPIFY_KEYS.includes(k));
  return NextResponse.json({
    ok: true,
    store: { ...s, apiCredentials: undefined, credentialKeys: shownKeys, hasCredentials: shownKeys.length > 0, etsy, tiktok, shopify },
  });
}

// PATCH — sửa store: name, sellerId, status, note, connectMethod, credentials
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "stores")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ ok: false }, { status: 400 });

  const isSeller = session.role === "seller";
  if (isSeller) {
    // Seller chỉ sửa được store của chính mình và không đổi chủ store
    const [own] = await db.select({ sellerId: schema.stores.sellerId }).from(schema.stores).where(eq(schema.stores.id, params.id)).limit(1);
    if (!own || own.sellerId !== session.sub) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    delete b.sellerId;
  }

  const patch: Record<string, unknown> = {};
  if (typeof b.name === "string" && b.name.trim()) {
    const nm = b.name.trim();
    const [dupName] = await db.select({ id: schema.stores.id })
      .from(schema.stores).where(and(sql`lower(${schema.stores.name}) = lower(${nm})`, ne(schema.stores.id, params.id))).limit(1);
    if (dupName) return NextResponse.json({ ok: false, error: `Tên store "${nm}" đã tồn tại — hãy dùng tên khác` }, { status: 409 });
    patch.name = nm;
  }
  if ("storeUrl" in b) patch.storeUrl = (typeof b.storeUrl === "string" && b.storeUrl.trim()) ? b.storeUrl.trim() : null;
  if ("sellerId" in b) patch.sellerId = b.sellerId || null;
  if ("note" in b) patch.note = b.note || null;
  if (typeof b.currency === "string" && b.currency.trim()) patch.currency = b.currency.trim().toUpperCase();
  if (b.fxRate != null && !isNaN(Number(b.fxRate)) && Number(b.fxRate) > 0) patch.fxRate = String(Number(b.fxRate));
  // % phí sàn ước tính: cho phép 0 (tắt ước tính) đến < 100
  if (b.feeRate != null && !isNaN(Number(b.feeRate)) && Number(b.feeRate) >= 0 && Number(b.feeRate) < 100) patch.feeRate = String(Number(b.feeRate));
  // ĐỔI CHỦ SHOP → BẮT BUỘC xoay ingest token. Token cũ nằm trong Extension trên máy/AdsPower của
  // seller cũ; không xoay thì họ nghỉ rồi vẫn bơm đơn vào shop được.
  const [before] = await db.select({ sellerId: schema.stores.sellerId }).from(schema.stores).where(eq(schema.stores.id, params.id)).limit(1);
  const oldSellerId = before?.sellerId ?? null;
  const handover = "sellerId" in b && (b.sellerId || null) !== oldSellerId;
  if (b.regenIngestToken === true || handover) patch.ingestToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  if (b.status && (schema.stores.status.enumValues as readonly string[]).includes(b.status)) patch.status = b.status;
  if (b.connectMethod && (schema.stores.connectMethod.enumValues as readonly string[]).includes(b.connectMethod)) patch.connectMethod = b.connectMethod;

  // Cập nhật credentials: merge các field không rỗng, xoá field gửi rỗng
  if (b.credentials && typeof b.credentials === "object") {
    const [cur] = await db.select({ c: schema.stores.apiCredentials }).from(schema.stores).where(eq(schema.stores.id, params.id)).limit(1);
    const merged = { ...(cur?.c as Record<string, string> ?? {}) };
    for (const [k, v] of Object.entries(b.credentials as Record<string, string>)) {
      if (v === "" || v === null) delete merged[k];
      else merged[k] = String(v);
    }
    patch.apiCredentials = merged;
  }

  // BÀN GIAO SHOP — cả 3 lệnh trong 1 transaction, đứt giữa chừng thì rollback sạch.
  //
  // orders.seller_id  : ĐỔI hết → seller mới mở được đơn cũ của shop mình (refund/reprint/hỗ trợ khách).
  // orders.seller_at_order : KHÔNG ĐỘNG VÀO → doanh số/KPI lịch sử vẫn thuộc seller cũ,
  //                          seller mới bắt đầu từ 0 trên shop này. Không đè, không cộng trùng.
  // designs.seller_id : chỉ những design có gắn store_id. Design tạo qua POST /api/designs KHÔNG có
  //                     store_id (route đó không ghi), nên phần lớn thư viện sẽ không khớp — trả về
  //                     số đếm thật để biết còn bao nhiêu phải xử lý tay, không im lặng.
  let moved = { orders: 0, designs: 0, kept: 0 };
  if (handover) {
    const sellerId = b.sellerId || null;
    await db.transaction(async (tx) => {
      await tx.update(schema.stores).set(patch).where(eq(schema.stores.id, params.id));
      const o = await tx.update(schema.orders).set({ sellerId, updatedAt: new Date() })
        .where(eq(schema.orders.storeId, params.id)).returning({ id: schema.orders.id });
      const d = await tx.update(schema.designs).set({ sellerId })
        .where(eq(schema.designs.storeId, params.id)).returning({ id: schema.designs.id });
      const [k] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.orders)
        .where(and(eq(schema.orders.storeId, params.id), sql`${schema.orders.sellerAtOrder} = ${oldSellerId}::uuid`));
      moved = { orders: o.length, designs: d.length, kept: Number(k?.n ?? 0) };
    });
  } else {
    // Không đổi chủ → không cascade gì cả (trước đây save modal lần nào cũng ghi lại
    // seller_id của toàn bộ đơn + bump updated_at, gây nhiễu vô ích).
    await db.update(schema.stores).set(patch).where(eq(schema.stores.id, params.id));
  }

  return NextResponse.json({ ok: true, ingestToken: patch.ingestToken as string | undefined, handover, moved });
}

// DELETE — xóa store (gỡ liên kết đơn/design về null để giữ lịch sử)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "stores")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  await db.update(schema.orders).set({ storeId: null }).where(eq(schema.orders.storeId, params.id));
  await db.update(schema.designs).set({ storeId: null }).where(eq(schema.designs.storeId, params.id));
  await db.delete(schema.stores).where(eq(schema.stores.id, params.id));
  return NextResponse.json({ ok: true });
}

// POST /api/stores/[id] với ?action=health — kiểm tra kết nối (mô phỏng nếu chưa có API thật)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "stores")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, params.id)).limit(1);
  if (!s) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const cred = (s.apiCredentials ?? {}) as Record<string, string>;
  const hasApi = s.connectMethod === "api" && Object.keys(cred).length > 0;
  // Chưa nối API thật của sàn → mô phỏng kết quả dựa trên có credentials hay không
  const health = {
    checkedAt: new Date().toISOString(),
    ok: hasApi,
    message: hasApi ? "API connection is valid" : s.connectMethod === "extension" ? "Store pulls orders via the Extension — no API needed" : "API credentials not configured",
  };
  await db.update(schema.stores).set({ health, lastSyncAt: new Date() }).where(eq(schema.stores.id, params.id));
  return NextResponse.json({ ok: true, health });
}
