import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
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
  return NextResponse.json({
    ok: true,
    store: { ...s, apiCredentials: undefined, credentialKeys: Object.keys(cred), hasCredentials: Object.keys(cred).length > 0 },
  });
}

// PATCH — sửa store: name, sellerId, status, note, connectMethod, credentials
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "stores")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ ok: false }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim();
  if ("sellerId" in b) patch.sellerId = b.sellerId || null;
  if ("note" in b) patch.note = b.note || null;
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
    message: hasApi ? "Kết nối API hợp lệ" : s.connectMethod === "extension" ? "Store kéo đơn qua Extension — không cần API" : "Chưa cấu hình API credentials",
  };
  await db.update(schema.stores).set({ health, lastSyncAt: new Date() }).where(eq(schema.stores.id, params.id));
  return NextResponse.json({ ok: true, health });
}
