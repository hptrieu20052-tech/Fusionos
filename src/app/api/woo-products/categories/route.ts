import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { wooApi, wooConfigured, type WooCred } from "@/lib/woocommerce";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/woo-products/categories — quản lý category WooCommerce từ FUSION (v497).
 *   GET  ?storeId=            — toàn bộ category (kèm parent + số sản phẩm)
 *   POST { storeId, name, parentId? } — tạo category mới
 */
async function wooCred(session: NonNullable<Awaited<ReturnType<typeof getSession>>>, storeId: string): Promise<WooCred | { error: string; status: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return { error: "missing storeId", status: 400 };
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!s) return { error: "store not found", status: 404 };
  if (s.marketplace !== "woocommerce") return { error: "not a WooCommerce store", status: 400 };
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && !(s.sellerId && scopeIds.includes(s.sellerId))) return { error: "forbidden", status: 403 };
  const cred = (((s.apiCredentials ?? {}) as Record<string, unknown>).woocommerce ?? {}) as WooCred;
  if (!wooConfigured(cred)) return { error: "Store chưa cấu hình WooCommerce API.", status: 400 };
  return cred;
}

const strv = (v: unknown) => (v == null ? "" : String(v)).trim();

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const cred = await wooCred(session, String(req.nextUrl.searchParams.get("storeId") ?? ""));
  if ("error" in cred) return NextResponse.json({ ok: false, error: cred.error }, { status: cred.status });

  try {
    // 100/trang là dư cho store thường; lấy tối đa 3 trang (300 category).
    const all: Record<string, unknown>[] = [];
    for (let page = 1; page <= 3; page++) {
      const batch = (await wooApi(cred, `products/categories?per_page=100&page=${page}&orderby=name`)) as Record<string, unknown>[];
      if (!Array.isArray(batch) || !batch.length) break;
      all.push(...batch);
      if (batch.length < 100) break;
    }
    const categories = all.map((c) => ({
      id: Number(c.id) || 0,
      name: strv(c.name),
      parent: Number(c.parent) || 0,
      count: Number(c.count) || 0,
      slug: strv(c.slug),
    })).filter((c) => c.slug !== "uncategorized");
    return NextResponse.json({ ok: true, categories });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const cred = await wooCred(session, String(b?.storeId ?? ""));
  if ("error" in cred) return NextResponse.json({ ok: false, error: cred.error }, { status: cred.status });

  const name = strv(b?.name).slice(0, 120);
  if (!name) return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
  const parentId = Number(b?.parentId) || 0;
  try {
    const c = (await wooApi(cred, "products/categories", {
      method: "POST",
      body: JSON.stringify({ name, ...(parentId > 0 ? { parent: parentId } : {}) }),
    })) as Record<string, unknown>;
    return NextResponse.json({ ok: true, category: { id: Number(c.id) || 0, name: strv(c.name), parent: Number(c.parent) || 0, count: 0, slug: strv(c.slug) } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 200 });
  }
}
