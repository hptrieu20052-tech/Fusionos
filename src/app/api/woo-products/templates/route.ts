import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds, sharedStoreIds, adminUserIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * /api/woo-products/templates — Templates cho Manage Products WooCommerce (v502).
 * Template = KHUNG listing (title mẫu, description chuẩn, giá, categories, tags, status) —
 * variants/size/màu plugin trên store lo, nên không nằm trong template.
 *   GET    ?storeId=                    — danh sách template của store
 *   POST   { storeId, template }        — tạo
 *   PUT    { storeId, template{id,…} }  — sửa
 *   DELETE ?storeId=&id=                — xoá
 */
async function checkStore(session: NonNullable<Awaited<ReturnType<typeof getSession>>>, storeId: string): Promise<true | { error: string; status: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return { error: "missing storeId", status: 400 };
  const [s] = await db.select({ id: schema.stores.id, mk: schema.stores.marketplace, sellerId: schema.stores.sellerId }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!s) return { error: "store not found", status: 404 };
  if (s.mk !== "woocommerce") return { error: "not a WooCommerce store", status: 400 };
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && !(s.sellerId && scopeIds.includes(s.sellerId))) {
    const shared = await sharedStoreIds(scopeIds);
    if (!shared.includes(s.id)) return { error: "forbidden", status: 403 };
  }
  return true;
}
/** v503 · seller bị scope → true (áp quy tắc "của ai người đó thấy" cho template). */
async function isScoped(session: NonNullable<Awaited<ReturnType<typeof getSession>>>): Promise<boolean> {
  return !!(await storeOwnerScopeIds(session));
}

type TplBody = { id?: string; name?: string; title?: string; description?: string; price?: string; salePrice?: string; categoryIds?: number[]; tags?: string; status?: string };
function tplFields(t: TplBody) {
  return {
    name: String(t.name ?? "").trim().slice(0, 120),
    title: String(t.title ?? "").trim().slice(0, 300) || null,
    description: String(t.description ?? "").slice(0, 60000) || null,
    price: String(t.price ?? "").trim().slice(0, 20) || null,
    salePrice: String(t.salePrice ?? "").trim().slice(0, 20) || null,
    categoryIds: (Array.isArray(t.categoryIds) ? t.categoryIds : []).map(Number).filter((n) => n > 0).slice(0, 20),
    tags: String(t.tags ?? "").trim().slice(0, 500) || null,
    status: ["publish", "draft"].includes(String(t.status)) ? String(t.status) : "publish",
  };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const storeId = String(req.nextUrl.searchParams.get("storeId") ?? "");
  const chk = await checkStore(session, storeId);
  if (chk !== true) return NextResponse.json({ ok: false, error: chk.error }, { status: chk.status });
  try {
    let templates = await db.select().from(schema.wooTemplates)
      .where(eq(schema.wooTemplates.storeId, storeId)).orderBy(asc(schema.wooTemplates.name));
    // v503 · mirror v459: seller thấy template MÌNH tạo + của admin (dùng được, không sửa/xoá).
    if (await isScoped(session)) {
      const admins = await adminUserIds();
      templates = templates.filter((t) => !t.createdBy || t.createdBy === session.sub || admins.includes(t.createdBy));
    }
    return NextResponse.json({ ok: true, templates });
  } catch {
    // Bảng chưa migrate → trả rỗng kèm cờ để UI hiện hướng dẫn chạy SQL.
    return NextResponse.json({ ok: true, templates: [], needMigration: true });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const storeId = String(b?.storeId ?? "");
  const chk = await checkStore(session, storeId);
  if (chk !== true) return NextResponse.json({ ok: false, error: chk.error }, { status: chk.status });
  const f = tplFields((b?.template ?? {}) as TplBody);
  if (!f.name) return NextResponse.json({ ok: false, error: "template name required" }, { status: 400 });
  try {
    const [row] = await db.insert(schema.wooTemplates).values({ ...f, storeId, createdBy: session.sub }).returning();
    return NextResponse.json({ ok: true, template: row });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const storeId = String(b?.storeId ?? "");
  const chk = await checkStore(session, storeId);
  if (chk !== true) return NextResponse.json({ ok: false, error: chk.error }, { status: chk.status });
  const t = (b?.template ?? {}) as TplBody;
  const id = String(t.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  const f = tplFields(t);
  if (!f.name) return NextResponse.json({ ok: false, error: "template name required" }, { status: 400 });
  if (await isScoped(session)) {
    const [row] = await db.select({ createdBy: schema.wooTemplates.createdBy }).from(schema.wooTemplates).where(eq(schema.wooTemplates.id, id)).limit(1);
    if (!row || row.createdBy !== session.sub) return NextResponse.json({ ok: false, error: "Only your own templates can be edited." }, { status: 403 });
  }
  try {
    await db.update(schema.wooTemplates).set({ ...f, updatedAt: new Date() }).where(eq(schema.wooTemplates.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const storeId = String(req.nextUrl.searchParams.get("storeId") ?? "");
  const chk = await checkStore(session, storeId);
  if (chk !== true) return NextResponse.json({ ok: false, error: chk.error }, { status: chk.status });
  const id = String(req.nextUrl.searchParams.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  if (await isScoped(session)) {
    const [row] = await db.select({ createdBy: schema.wooTemplates.createdBy }).from(schema.wooTemplates).where(eq(schema.wooTemplates.id, id)).limit(1);
    if (!row || row.createdBy !== session.sub) return NextResponse.json({ ok: false, error: "Only your own templates can be deleted." }, { status: 403 });
  }
  try {
    await db.delete(schema.wooTemplates).where(eq(schema.wooTemplates.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
