import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopHost, type ShopifyCred } from "@/lib/shopify";
import { listPublications, listCatalogs, listCustomCollections } from "@/lib/shopify-bulk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/shopify-products/channels?storeId=...
 * Trả sales channels (publications), catalogs, và manual collections của store — để build picker cho bulk actions.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const storeId = req.nextUrl.searchParams.get("storeId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return NextResponse.json({ ok: false, error: "storeId required" }, { status: 400 });

  const [store] = await db.select({ cred: schema.stores.apiCredentials, seller: schema.stores.sellerId, mk: schema.stores.marketplace, name: schema.stores.name })
    .from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) return NextResponse.json({ ok: false, error: "store not found" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!store.seller || !scopeIds.includes(store.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const cred = (store.cred ?? {}) as ShopifyCred;
  if (store.mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret)))
    return NextResponse.json({ ok: false, error: "store chưa cấu hình Shopify API" }, { status: 400 });

  try {
    const [publications, catalogs, collections] = await Promise.all([
      listPublications(cred).catch(() => []),
      listCatalogs(cred).catch(() => []),
      listCustomCollections(cred).catch(() => []),
    ]);
    return NextResponse.json({ ok: true, store: store.name, publications, catalogs, collections });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
