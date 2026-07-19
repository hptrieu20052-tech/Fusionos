import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listLenfulStores } from "@/lib/lenful";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST { fulfillerId, userName?, password? } — liệt kê STORE Lenful (id = :store_id khi tạo đơn).
// Ưu tiên creds gõ trong form (chưa Save vẫn dùng được); thiếu thì lấy creds đã lưu.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as Record<string, string>;
  const userName = (b.userName || "").trim() || c.userName || c.user_name || c.identifier || "";
  const password = (b.password || "").trim() || c.password || c.apiKey || "";
  if (!userName || !password) return NextResponse.json({ ok: false, error: "Điền user_name + Password (hoặc Save trước) rồi bấm Get Store" }, { status: 400 });

  try {
    const shops = await listLenfulStores({ endpoint: ff.apiEndpoint, userName, password });
    return NextResponse.json({ ok: true, shops });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
