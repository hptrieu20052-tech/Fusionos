import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { parseOrderIds } from "@/lib/ignored-orders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET — tổng số ID đang chặn + 20 ID nạp gần nhất (để đối chiếu sau khi upload). */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  try {
    const [c] = (await db.execute(sql`SELECT count(*)::int AS n FROM ignored_orders`)).rows as { n: number }[];
    const recent = (await db.execute(sql`
      SELECT external_id, note, created_at FROM ignored_orders
      ORDER BY created_at DESC LIMIT 20
    `)).rows;
    return NextResponse.json({ ok: true, total: c?.n ?? 0, recent });
  } catch {
    // bảng chưa migrate
    return NextResponse.json({ ok: true, total: 0, recent: [], needsMigration: true });
  }
}

/** POST { raw, note } — nạp hàng loạt Order ID (dán text hoặc nội dung file). */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const ids = parseOrderIds(String(b?.raw ?? ""));
  if (!ids.length) return NextResponse.json({ ok: false, error: "No order IDs found in the input" }, { status: 400 });

  const note = String(b?.note ?? "").trim().slice(0, 120) || null;

  // Chèn theo lô 1000 để tránh câu SQL quá dài
  let added = 0;
  try {
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const res = await db.execute(sql`
        INSERT INTO ignored_orders (external_id, note)
        VALUES ${sql.join(chunk.map((id) => sql`(${id}, ${note})`), sql`, `)}
        ON CONFLICT (external_id) DO NOTHING
      `);
      added += res.rowCount ?? 0;
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }

  const [c] = (await db.execute(sql`SELECT count(*)::int AS n FROM ignored_orders`)).rows as { n: number }[];
  return NextResponse.json({ ok: true, parsed: ids.length, added, duplicated: ids.length - added, total: c?.n ?? 0 });
}

/** DELETE — xoá sạch blocklist (sau khi chuyển hệ thống xong hẳn). */
export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  await db.execute(sql`DELETE FROM ignored_orders`);
  return NextResponse.json({ ok: true, total: 0 });
}
