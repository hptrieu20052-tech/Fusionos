import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listPrintifyShops } from "@/lib/printify";

export const dynamic = "force-dynamic";

/**
 * POST { token? , fulfillerId? } — trả danh sách shop Printify (id + tên).
 * Dùng để tìm shop_id và test kết nối token. Nếu không truyền token thì lấy token
 * đã lưu của fulfiller.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  let token: string | undefined = b?.token;
  if (!token && b?.fulfillerId) {
    const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
    const c = (ff?.credentials ?? {}) as { apiKey?: string; apiToken?: string };
    token = c.apiKey || c.apiToken;
  }
  if (!token) return NextResponse.json({ ok: false, error: "thiếu token" }, { status: 400 });
  try {
    const shops = await listPrintifyShops(token);
    return NextResponse.json({ ok: true, shops: shops.map((s) => ({ id: s.id, title: s.title, channel: s.sales_channel })) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}
