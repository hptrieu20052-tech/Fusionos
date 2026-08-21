import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { storeOwnerScopeIds } from "@/lib/scope";
import { payloadOf, type PQ } from "@/lib/personalization";
import AmazonExportClient, { type Pattern } from "./export-client";

export const dynamic = "force-dynamic";

type Tpl = typeof schema.shopifyTemplates.$inferSelect;

// Cùng luật khớp template với push-personalization:
// gán tay → khớp Product type → ACTIVE duy nhất của store → duy nhất của store.
function tplFor(tpls: Tpl[], storeId: string, productType: string | null, pinnedId: string | null): Tpl | null {
  if (pinnedId) { const p = tpls.find((t) => t.id === pinnedId); if (p) return p; }
  const list = tpls.filter((t) => t.storeId === storeId);
  const pt = (productType ?? "").trim().toLowerCase();
  if (pt) { const m = list.find((t) => (t.productType ?? "").trim().toLowerCase() === pt); if (m) return m; }
  const active = list.filter((t) => t.status === "ACTIVE");
  if (active.length === 1) return active[0];
  if (list.length === 1) return list[0];
  return null;
}

// Chữ ký ổn định của 1 bộ custom — 2 sản phẩm cùng chữ ký = dùng chung 1 Amazon Custom template.
function sigOf(pqs: PQ[]): string {
  return JSON.stringify(pqs.map((q) => ({ t: q.type, l: q.label, r: q.required, m: q.maxChars, o: q.options, f: q.maxFiles })));
}

function fieldLabel(q: PQ): string {
  if (q.type === "dropdown") return `List · ${q.options.length} options`;
  if (q.type === "upload") return `Photo upload · ${q.maxFiles} file(s)`;
  return `Text · ${q.maxChars} chars`;
}

export default async function AmazonExportPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty">You don&apos;t have permission to view this page.</div>;
  const lvl = await levelOf(session, "products");
  if (lvl < 1) return <div className="panel empty">You don&apos;t have permission to view this page.</div>;

  const scopeIds = await storeOwnerScopeIds(session);

  // Store Shopify trong phạm vi của user
  const storesWhere = scopeIds
    ? and(eq(schema.stores.marketplace, "shopify"), inArray(schema.stores.sellerId, scopeIds))
    : eq(schema.stores.marketplace, "shopify");
  const stores = await db.select({ id: schema.stores.id }).from(schema.stores).where(storesWhere);
  const storeIds = stores.map((s) => s.id);

  if (!storeIds.length) {
    return <AmazonExportClient patterns={[]} totalProducts={0} noCustomCount={0} />;
  }

  const products = await db.select({
    id: schema.shopifyProducts.id,
    title: schema.shopifyProducts.title,
    handle: schema.shopifyProducts.handle,
    storeId: schema.shopifyProducts.storeId,
    productType: schema.shopifyProducts.productType,
    status: schema.shopifyProducts.status,
    templateId: schema.shopifyProducts.templateId,
    personalization: schema.shopifyProducts.personalization,
    variants: schema.shopifyProducts.variants,
  }).from(schema.shopifyProducts).where(inArray(schema.shopifyProducts.storeId, storeIds));

  const tpls = await db.select().from(schema.shopifyTemplates);

  const groups = new Map<string, Pattern>();
  let noCustom = 0;

  for (const p of products) {
    const hasOwn = Array.isArray(p.personalization);
    let eff: PQ[];
    if (hasOwn) {
      eff = payloadOf(p.personalization);
    } else {
      const tpl = tplFor(tpls, p.storeId, p.productType, p.templateId);
      eff = tpl ? payloadOf(tpl.personalization) : [];
    }

    if (!eff.length) { noCustom++; continue; }

    const sig = sigOf(eff);
    const variants = (Array.isArray(p.variants) ? p.variants : []) as Array<{ sku?: string | null }>;
    const sku = variants.map((v) => v?.sku).find((s): s is string => !!s) ?? p.handle ?? "";

    let g = groups.get(sig);
    if (!g) {
      g = {
        sig,
        count: 0,
        fields: eff.map((q) => ({ type: q.type, label: q.label, detail: fieldLabel(q), required: q.required })),
        samples: [],
        productIds: [],
        productTypes: {},
      };
      groups.set(sig, g);
    }
    g.count++;
    g.productIds.push(p.id);
    if (g.samples.length < 6) g.samples.push({ sku, title: p.title });
    const pt = (p.productType ?? "—").trim() || "—";
    g.productTypes[pt] = (g.productTypes[pt] ?? 0) + 1;
  }

  const patterns = Array.from(groups.values()).sort((a, b) => b.count - a.count);

  return (
    <AmazonExportClient
      patterns={patterns}
      totalProducts={products.length}
      noCustomCount={noCustom}
    />
  );
}
