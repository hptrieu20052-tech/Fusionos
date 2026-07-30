import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { shopifyGraphQL, shopHost, type ShopifyCred } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/**
 * GET /api/shopify-products/taxonomy?storeId=...&q=book
 * Tìm Category trong Shopify Standard Product Taxonomy (để chọn cho template).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const storeId = req.nextUrl.searchParams.get("storeId") ?? "";
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return NextResponse.json({ ok: false, error: "storeId required" }, { status: 400 });
  if (!q) return NextResponse.json({ ok: true, categories: [] });

  const [store] = await db.select({ cred: schema.stores.apiCredentials, seller: schema.stores.sellerId, mk: schema.stores.marketplace })
    .from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) return NextResponse.json({ ok: false, error: "store not found" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!store.seller || !scopeIds.includes(store.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const cred = (store.cred ?? {}) as ShopifyCred;
  if (store.mk !== "shopify" || !shopHost(cred) || !(cred.adminToken || (cred.clientId && cred.clientSecret)))
    return NextResponse.json({ ok: false, error: "store chưa cấu hình Shopify API" }, { status: 400 });

  try {
    const d = await shopifyGraphQL<{ taxonomy?: { categories?: { edges?: { node?: { id: string; fullName?: string; name?: string } }[] } } }>(
      cred,
      `query($search: String!) { taxonomy { categories(first: 25, search: $search) { edges { node { id fullName name } } } } }`,
      { search: q },
    );
    const categories = (d.taxonomy?.categories?.edges ?? []).map((e) => ({ id: String(e.node?.id ?? ""), name: String(e.node?.fullName ?? e.node?.name ?? "") })).filter((c) => c.id);
    return NextResponse.json({ ok: true, categories });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
