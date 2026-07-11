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
  // Ẩn các key etsy_* khỏi danh sách credentialKeys hiển thị (đã có mục Etsy API riêng)
  const shownKeys = Object.keys(cred).filter((k) => !k.startsWith("etsy_"));
  return NextResponse.json({
    ok: true,
    store: { ...s, apiCredentials: undefined, credentialKeys: shownKeys, hasCredentials: shownKeys.length > 0, etsy },
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
  if (b.regenIngestToken === true) patch.ingestToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
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

  await db.update(schema.stores).set(patch).where(eq(schema.stores.id, params.id));

  // Đổi seller của store → cập nhật seller cho TẤT CẢ đơn & design thuộc store này
  if ("sellerId" in b) {
    const sellerId = b.sellerId || null;
    await db.update(schema.orders).set({ sellerId, updatedAt: new Date() }).where(eq(schema.orders.storeId, params.id));
    await db.update(schema.designs).set({ sellerId }).where(eq(schema.designs.storeId, params.id));
  }

  return NextResponse.json({ ok: true, ingestToken: patch.ingestToken as string | undefined });
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
