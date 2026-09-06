import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { shopbaseApi, shopbaseConfigured, type ShopBaseCred } from "@/lib/shopbase";

export const dynamic = "force-dynamic";

/**
 * v408b · DEBUG (admin-only) — xem JSON GỐC của 1 sản phẩm từ ShopBase REST.
 * GET /api/shopbase-products/debug?id=<uuid local>  (hoặc ?pid=<id số ShopBase>&store=<uuid store>)
 * Dùng để dò field "Available" thật của ShopBase: so JSON của 1 sản phẩm đang Available
 * với 1 sản phẩm Unavailable → field nào khác nhau là field publish thật.
 * Cắt bớt variants/images (chỉ giữ số lượng + 1 mẫu) cho dễ đọc.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });

  const id = String(req.nextUrl.searchParams.get("id") ?? "").trim();
  let pid = String(req.nextUrl.searchParams.get("pid") ?? "").trim();
  let storeId = String(req.nextUrl.searchParams.get("store") ?? "").trim();

  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const [row] = await db.select({ pid: schema.shopbaseProducts.shopbaseProductId, storeId: schema.shopbaseProducts.storeId })
      .from(schema.shopbaseProducts).where(eq(schema.shopbaseProducts.id, id)).limit(1);
    if (!row) return NextResponse.json({ ok: false, error: "local product not found" }, { status: 404 });
    pid = row.pid; storeId = row.storeId;
  }
  // v429 · cho phép ?pid= một mình — tra store từ dòng local (dán số #ID trong Manage Products là đủ)
  if (pid && !/^[0-9a-f-]{36}$/i.test(storeId)) {
    const [row] = await db.select({ storeId: schema.shopbaseProducts.storeId })
      .from(schema.shopbaseProducts).where(eq(schema.shopbaseProducts.shopbaseProductId, pid)).limit(1);
    if (row) storeId = row.storeId;
  }
  if (!pid || !/^[0-9a-f-]{36}$/i.test(storeId)) return NextResponse.json({ ok: false, error: "pass ?id=<local uuid> or ?pid=<shopbase id>[&store=<store uuid>]" }, { status: 400 });

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  const cred = ((store?.apiCredentials ?? {}) as Record<string, unknown>).shopbase as ShopBaseCred | undefined;
  if (!store || store.marketplace !== "shopbase" || !shopbaseConfigured(cred ?? null)) {
    return NextResponse.json({ ok: false, error: "store not found / not configured" }, { status: 400 });
  }

  try {
    const j = await shopbaseApi(cred!, `products/${pid}.json`);
    const p = (j.product ?? j) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) {
      if (k === "variants" || k === "images") {
        const arr = Array.isArray(v) ? v : [];
        out[k] = { count: arr.length, sample: arr[0] ?? null };
      } else if (k === "body_html") {
        out[k] = String(v ?? "").slice(0, 120) + "…";
      } else out[k] = v;
    }
    return NextResponse.json({ ok: true, product: out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) });
  }
}
