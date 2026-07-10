import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db, schema } from "@/lib/db";
import { desc, eq, and, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { scopeOwnerIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

// GET /api/stores?sellerId=&marketplace=
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "stores")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const scopeIds = await scopeOwnerIds(session, "stores");
  const parts = [];
  // Phạm vi own/team: chỉ store thuộc seller trong phạm vi (store chưa gán seller cũng bị ẩn)
  if (scopeIds) parts.push(inArray(schema.stores.sellerId, scopeIds));
  else if (sp.get("sellerId")) parts.push(eq(schema.stores.sellerId, sp.get("sellerId")!));
  if (sp.get("marketplace")) parts.push(eq(schema.stores.marketplace, sp.get("marketplace") as never));
  const where = parts.length ? and(...parts) : undefined;

  const rows = await db
    .select({ s: schema.stores, sellerName: schema.users.fullName })
    .from(schema.stores)
    .leftJoin(schema.users, eq(schema.stores.sellerId, schema.users.id))
    .where(where)
    .orderBy(desc(schema.stores.createdAt));

  // Đơn 30d + 7d để đánh giá "live" (có đơn gần đây)
  const counts = await db.execute(sql`
    SELECT store_id,
      count(*) FILTER (WHERE ordered_at > NOW()-interval '30 days')::int c30,
      count(*) FILTER (WHERE ordered_at > NOW()-interval '7 days')::int c7,
      coalesce(sum(total) FILTER (WHERE ordered_at > NOW()-interval '30 days'),0) rev30,
      max(ordered_at) last_order
    FROM orders WHERE store_id IS NOT NULL GROUP BY store_id`);
  const cmap = new Map((counts.rows as { store_id: string; c30: number; c7: number; rev30: string; last_order: string }[]).map((r) => [r.store_id, r]));

  const sellers = await db.select({ id: schema.users.id, name: schema.users.fullName })
    .from(schema.users)
    .where(scopeIds ? and(eq(schema.users.role, "seller"), inArray(schema.users.id, scopeIds)) : eq(schema.users.role, "seller"));

  return NextResponse.json({
    ok: true,
    sellers,
    scoped: !!scopeIds,
    stores: rows.map((r) => {
      const c = cmap.get(r.s.id);
      const lastOrder = c?.last_order ? new Date(c.last_order) : null;
      const daysSince = lastOrder ? Math.floor((Date.now() - lastOrder.getTime()) / 86400000) : null;
      // live nếu có đơn trong 7 ngày; die nếu store active nhưng >14 ngày không đơn
      const live = (c?.c7 ?? 0) > 0;
      return {
        ...r.s,
        apiCredentials: undefined,
        hasCredentials: !!r.s.apiCredentials,
        credentialKeys: r.s.apiCredentials ? Object.keys(r.s.apiCredentials as object) : [],
        sellerName: r.sellerName,
        orders30d: c?.c30 ?? 0,
        orders7d: c?.c7 ?? 0,
        revenue30d: Number(c?.rev30 ?? 0),
        lastOrderDays: daysSince,
        live,
      };
    }),
  });
}

// POST tạo store
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "stores")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b?.name || !schema.stores.marketplace.enumValues.includes(b.marketplace) || !schema.stores.connectMethod.enumValues.includes(b.connectMethod)) {
    return NextResponse.json({ ok: false, error: "Thiếu tên / sàn / phương thức kết nối" }, { status: 400 });
  }
  // Chặn trùng tên store (không phân biệt hoa/thường) — tránh nhầm lẫn khi khớp đơn về sau
  const name = String(b.name).trim();
  const [dupName] = await db.select({ id: schema.stores.id })
    .from(schema.stores).where(sql`lower(${schema.stores.name}) = lower(${name})`).limit(1);
  if (dupName) return NextResponse.json({ ok: false, error: `Tên store "${name}" đã tồn tại — hãy dùng tên khác` }, { status: 409 });

  // Seller tạo store → luôn là store của chính mình (bỏ qua sellerId gửi lên)
  const sellerId = session.role === "seller" ? session.sub : (b.sellerId || null);
  const ingestToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const [s] = await db.insert(schema.stores).values({
    name, marketplace: b.marketplace, connectMethod: b.connectMethod,
    sellerId, status: "active", note: b.note, ingestToken,
    storeUrl: (typeof b.storeUrl === "string" && b.storeUrl.trim()) ? b.storeUrl.trim() : null,
    currency: (typeof b.currency === "string" && b.currency.trim()) ? b.currency.trim().toUpperCase() : "USD",
    fxRate: (b.fxRate != null && Number(b.fxRate) > 0) ? String(Number(b.fxRate)) : "1",
  }).returning();
  return NextResponse.json({ ok: true, store: s });
}
