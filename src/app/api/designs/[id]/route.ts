import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

// GET — chi tiết design đầy đủ cho modal: files, người liên quan, điểm, đơn phát sinh + data cho các select
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const [d] = await db.select().from(schema.designs).where(eq(schema.designs.id, params.id)).limit(1);
  if (!d) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const files = await db.select().from(schema.designFiles).where(eq(schema.designFiles.designId, d.id));
  const names = await db.execute(sql`
    SELECT
      (SELECT full_name FROM users WHERE id = ${d.designerId ?? null}::uuid) AS designer,
      (SELECT full_name FROM users WHERE id = ${d.sellerId ?? null}::uuid) AS seller,
      (SELECT full_name FROM users WHERE id = ${d.creatorId ?? null}::uuid) AS creator,
      (SELECT name FROM stores WHERE id = ${d.storeId ?? null}::uuid) AS store
  `);
  const n = names.rows[0] as { designer: string | null; seller: string | null; creator: string | null; store: string | null };

  const orders = await db.execute(sql`SELECT count(*)::int c, coalesce(sum(oi.qty),0)::int items FROM order_items oi WHERE oi.design_id = ${d.id}`);
  const score = await db.execute(sql`SELECT avg(total_score)::numeric(4,2) s, count(*)::int c FROM design_reviews WHERE design_id = ${d.id}`);

  // Data cho các dropdown trong modal
  const people = (await db.execute(sql`SELECT id, full_name AS name, role FROM users WHERE role IN ('seller','designer','content') AND status='active' ORDER BY full_name`)).rows as { id: string; name: string; role: string }[];
  const storesR = (await db.execute(sql`SELECT id, name FROM stores ORDER BY name`)).rows;

  return NextResponse.json({
    ok: true,
    design: { ...d, designerName: n.designer, sellerName: n.seller, creatorName: n.creator, storeName: n.store },
    files: files.map((f) => ({ ...f, sizeBytes: Number(f.sizeBytes), thumbUrl: fileUrl(f.thumbKey), previewUrl: fileUrl(f.previewKey), originalUrl: fileUrl(f.storageKey) })),
    ordersGenerated: orders.rows[0] as { c: number; items: number },
    avgScore: Number((score.rows[0] as { s: string | null }).s ?? 0),
    reviewCount: (score.rows[0] as { c: number }).c,
    sellers: people.filter((p) => p.role === "seller"),
    designers: people.filter((p) => p.role === "designer"),
    creators: people.filter((p) => p.role === "content"),
    stores: storesR,
  });
}

// PATCH — sửa toàn bộ thông tin design
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ ok: false }, { status: 400 });
  const patch: Record<string, unknown> = {};
  for (const k of ["title", "description", "productLink", "note"] as const) if (typeof b[k] === "string") patch[k] = b[k];
  for (const k of ["sellerId", "designerId", "creatorId", "storeId"] as const) if (k in b) patch[k] = b[k] || null;
  if (Number.isInteger(b.points) && b.points >= 0 && b.points <= 10) patch.points = b.points;
  if (typeof b.listed === "boolean") patch.listed = b.listed;
  if (typeof b.personalize === "boolean") patch.personalize = b.personalize;
  if (Array.isArray(b.tags)) patch.tags = b.tags.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 20);
  if ("platform" in b) patch.platform = b.platform && (schema.designs.platform.enumValues as readonly string[]).includes(b.platform) ? b.platform : null;
  await db.update(schema.designs).set(patch).where(eq(schema.designs.id, params.id));
  return NextResponse.json({ ok: true });
}

// DELETE — xoá design (cần quyền mức 2; files xoá cascade)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  await db.delete(schema.designs).where(eq(schema.designs.id, params.id));
  return NextResponse.json({ ok: true });
}
