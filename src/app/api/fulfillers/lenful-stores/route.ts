import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listLenfulStores, pickLenfulV8Key } from "@/lib/lenful";

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
  // v692 · ưu tiên key v8 (lf_…) ở BẤT KỲ field nào — form gõ tay vẫn thắng nếu chính nó là key lf_.
  const typed = (b.password || "").trim();
  const password = (/^lf_[a-z0-9]+_/i.test(typed) ? typed : "") || pickLenfulV8Key(c) || typed || c.password || c.apiKey || "";
  const isV8 = /^lf_[a-z0-9]+_/i.test(password);
  if (!password || (!isV8 && !userName)) return NextResponse.json({ ok: false, error: "Điền API key lf_… (v8) hoặc user_name + Password (V6) rồi bấm Get Store" }, { status: 400 });

  try {
    const shops = await listLenfulStores({ endpoint: ff.apiEndpoint, userName, password });
    return NextResponse.json({ ok: true, shops });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
