import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

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
  const maps = await db.select().from(schema.skuMappings);
  return NextResponse.json({
    ok: true,
    fulfillers: ffs.map((f) => ({ ...f, shopId: (f.credentials as { shopId?: string } | null)?.shopId ?? null, credentials: f.credentials ? "•••• đã lưu" : null, hasWebhookSecret: !!f.webhookSecret, webhookSecret: undefined })),
    mappings: maps,
  });
}

export async function POST(req: NextRequest) {
  if (!(await guard(2))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.name || !["api", "excel"].includes(b.method)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  try {
    const [f] = await db.insert(schema.fulfillers).values({
      name: b.name.trim(), method: b.method, apiEndpoint: b.apiEndpoint || null,
      webhookSecret: b.webhookSecret || null, autoPush: !!b.autoPush,
      credentials: b.apiKey ? { apiKey: b.apiKey } : null,
    }).returning();
    return NextResponse.json({ ok: true, id: f.id });
  } catch { return NextResponse.json({ ok: false, error: "tên đã tồn tại" }, { status: 409 }); }
}

export async function PATCH(req: NextRequest) {
  if (!(await guard(2))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (typeof b.apiEndpoint === "string") patch.apiEndpoint = b.apiEndpoint || null;
  if (typeof b.webhookSecret === "string" && b.webhookSecret) patch.webhookSecret = b.webhookSecret;
  // Credentials: gộp apiKey (token) + shopId (cho Printify). Giữ giá trị cũ nếu chỉ đổi 1 phần.
  if ((typeof b.apiKey === "string" && b.apiKey) || (b.shopId !== undefined && b.shopId !== "")) {
    const [cur] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.id)).limit(1);
    const prev = (cur?.credentials ?? {}) as Record<string, unknown>;
    patch.credentials = {
      ...prev,
      ...(b.apiKey ? { apiKey: b.apiKey } : {}),
      ...(b.shopId !== undefined && b.shopId !== "" ? { shopId: String(b.shopId) } : {}),
    };
  }
  if (typeof b.autoPush === "boolean") patch.autoPush = b.autoPush;
  await db.update(schema.fulfillers).set(patch).where(eq(schema.fulfillers.id, b.id));
  return NextResponse.json({ ok: true });
}
