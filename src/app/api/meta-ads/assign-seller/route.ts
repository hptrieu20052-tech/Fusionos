import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { inArray, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * v632 · GÁN CHỦ CHO AD (bảng meta_ad_sellers, manual=true — auto-sync không bao giờ đè).
 * Dùng cho ads tạo TRƯỚC hệ thống Meta Ads Kit (creative không link listing → "(unassigned)").
 * GET  → danh sách user gán được (admin + seller) cho dropdown.
 * POST { adIds: string[], sellerId: string | null } — sellerId null = XOÁ gán tay (quay về auto).
 * Gán xong: By-seller, seller-view và CHI PHÍ ADS bên Finance đều ăn theo. Admin only.
 */
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const rows = await db.select({ id: schema.users.id, name: schema.users.fullName, role: schema.users.role })
    .from(schema.users).where(inArray(schema.users.role, ["admin", "seller"] as never[]));
  const sellers = rows
    .map((r) => ({ id: r.id, name: String(r.name ?? "").trim(), role: String(r.role) }))
    .filter((r) => r.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ ok: true, sellers });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null) as { adIds?: unknown; sellerId?: unknown } | null;
  const adIds = (Array.isArray(b?.adIds) ? b!.adIds : []).map((x) => String(x ?? "").replace(/\D/g, "")).filter(Boolean).slice(0, 500);
  if (!adIds.length) return NextResponse.json({ ok: false, error: "adIds required" }, { status: 400 });
  const sellerId = b?.sellerId == null ? null : String(b.sellerId);

  try {
    if (!sellerId) {
      // Xoá gán tay → lần /entities sau chuỗi auto (nếu có) sẽ ghi lại
      await db.delete(schema.metaAdSellers).where(inArray(schema.metaAdSellers.adId, adIds));
      return NextResponse.json({ ok: true, cleared: adIds.length });
    }
    const [u] = await db.select({ id: schema.users.id, name: schema.users.fullName }).from(schema.users)
      .where(sql`${schema.users.id} = ${sellerId}::uuid`).limit(1);
    if (!u) return NextResponse.json({ ok: false, error: "seller not found" }, { status: 400 });
    const name = String(u.name ?? "").trim();
    if (!name) return NextResponse.json({ ok: false, error: "seller has no full name — set it in Admin → HR first" }, { status: 400 });
    await db.execute(sql`
      INSERT INTO meta_ad_sellers (ad_id, seller_name, seller_id, manual, updated_at)
      VALUES ${sql.join(adIds.map((id) => sql`(${id}, ${name}, ${u.id}::uuid, true, now())`), sql`, `)}
      ON CONFLICT (ad_id) DO UPDATE SET seller_name = excluded.seller_name, seller_id = excluded.seller_id, manual = true, updated_at = now()
    `);
    return NextResponse.json({ ok: true, assigned: adIds.length, seller: name });
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    return NextResponse.json({ ok: false, error: /meta_ad_sellers/.test(m) ? "Run MIGRATION_v632_meta_ad_sellers.sql first" : m.slice(0, 300) }, { status: 400 });
  }
}
