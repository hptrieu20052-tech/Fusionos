import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { hasAction } from "@/lib/actions";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

async function guard(min: 1 | 2) {
  const session = await getSession();
  if (!session) return null;
  if ((await levelOf(session, "settings")) < min) return null;
  return session;
}

export async function GET() {
  if (!(await guard(1))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const ffs = await db.select().from(schema.fulfillers);
  // Đếm mapping + ghim theo từng nhà (KHÔNG kéo toàn bộ rows — bảng dùng /api/mappings/list phân trang)
  const counts = await db.select({
    fid: schema.skuMappings.fulfillerId,
    total: sql<number>`count(*)::int`,
    pinned: sql<number>`count(*) filter (where ${schema.skuMappings.pinned})::int`,
  }).from(schema.skuMappings).groupBy(schema.skuMappings.fulfillerId);
  const cmap = new Map(counts.map((c) => [c.fid, c]));
  return NextResponse.json({
    ok: true,
    fulfillers: ffs.map((f) => ({ ...f, shopId: (f.credentials as { shopId?: string } | null)?.shopId ?? null, identifier: (f.credentials as { identifier?: string } | null)?.identifier ?? null, credentials: f.credentials ? "•••• saved" : null, hasWebhookSecret: !!f.webhookSecret, webhookSecret: undefined, logoUrl: fileUrl(f.logoKey), mapCount: cmap.get(f.id)?.total ?? 0, pinnedCount: cmap.get(f.id)?.pinned ?? 0 })),
  });
}

export async function POST(req: NextRequest) {
  const _s = await guard(2);
  if (!_s) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!(await hasAction(_s, "fulfillment.credentials"))) return NextResponse.json({ ok: false, error: "forbidden: credentials" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.name || !["api", "excel", "gsheet"].includes(b.method)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  try {
    const credentials = b.method === "gsheet"
      ? { kind: "gsheet", sheetId: String(b.sheetId || "").trim(), tab: String(b.tab || "").trim() }
      : (b.apiKey ? { apiKey: b.apiKey } : null);
    const [f] = await db.insert(schema.fulfillers).values({
      name: b.name.trim(), method: b.method, apiEndpoint: b.apiEndpoint || null,
      webhookSecret: b.webhookSecret || null, autoPush: !!b.autoPush,
      logoKey: b.logoKey || null,
      credentials,
    }).returning();
    return NextResponse.json({ ok: true, id: f.id });
  } catch { return NextResponse.json({ ok: false, error: "name already exists" }, { status: 409 }); }
}

export async function PATCH(req: NextRequest) {
  const _s = await guard(2);
  if (!_s) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!(await hasAction(_s, "fulfillment.credentials"))) return NextResponse.json({ ok: false, error: "forbidden: credentials" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (typeof b.apiEndpoint === "string") patch.apiEndpoint = b.apiEndpoint || null;
  if (typeof b.webhookSecret === "string" && b.webhookSecret) patch.webhookSecret = b.webhookSecret;
  // Credentials: gộp apiKey (token) + shopId (Printify) + identifier + warehouse/carrier (Merchize TikTok Shipping). Giữ giá trị cũ nếu chỉ đổi 1 phần.
  // apiKey/shopId/identifier: ô rỗng = KHÔNG đổi (tránh xoá nhầm token). warehouse/carrier: gửi ô (kể cả rỗng) = ĐẶT đúng giá trị đó, rỗng = XOÁ.
  if ((typeof b.apiKey === "string" && b.apiKey) || (b.shopId !== undefined && b.shopId !== "") || (b.identifier !== undefined && b.identifier !== "") || typeof b.warehouse === "string" || typeof b.carrier === "string") {
    const [cur] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.id)).limit(1);
    const prev = (cur?.credentials ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = {
      ...prev,
      ...(b.apiKey ? { apiKey: b.apiKey } : {}),
      ...(b.shopId !== undefined && b.shopId !== "" ? { shopId: String(b.shopId) } : {}),
      ...(b.identifier !== undefined && b.identifier !== "" ? { identifier: String(b.identifier) } : {}),
    };
    // warehouse/carrier: cho phép XOÁ khi để trống
    if (typeof b.warehouse === "string") { const w = b.warehouse.trim(); if (w) next.warehouse = w; else delete next.warehouse; }
    if (typeof b.carrier === "string") { const c = b.carrier.trim(); if (c) next.carrier = c; else delete next.carrier; }
    patch.credentials = next;
  }
  if (typeof b.autoPush === "boolean") patch.autoPush = b.autoPush;
  if (typeof b.logoKey === "string" && b.logoKey) patch.logoKey = b.logoKey;
  await db.update(schema.fulfillers).set(patch).where(eq(schema.fulfillers.id, b.id));
  return NextResponse.json({ ok: true });
}

// DELETE { id } — xóa fulfiller (chặn nếu đã có đơn đẩy qua để giữ lịch sử)
export async function DELETE(req: NextRequest) {
  const _s = await guard(2);
  if (!_s) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!(await hasAction(_s, "fulfillment.credentials"))) return NextResponse.json({ ok: false, error: "forbidden: credentials" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  // Có đơn fulfillment đã đẩy qua nhà này → không xóa (giữ lịch sử)
  const ffo = await db.select({ id: schema.fulfillmentOrders.id }).from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.fulfillerId, b.id)).limit(1);
  if (ffo.length) return NextResponse.json({ ok: false, error: "Orders have already been pushed to this provider — can't delete. You can leave it (not configuring a token means it's unused)." }, { status: 409 });
  // Dọn cấu hình liên quan rồi xóa
  await db.delete(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, b.id));
  await db.update(schema.orderIssues).set({ fulfillerId: null }).where(eq(schema.orderIssues.fulfillerId, b.id));
  await db.delete(schema.fulfillers).where(eq(schema.fulfillers.id, b.id));
  return NextResponse.json({ ok: true });
}
