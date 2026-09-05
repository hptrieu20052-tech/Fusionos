import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// v404 · Quản lý Custom label 0 của feed GMC ngay trong FUSION.
// GET  /api/shopify-products/feed-labels?store=<uuid>            → danh sách rule của store
// POST /api/shopify-products/feed-labels { storeId, rules: [{ collectionTitle, label }] }
//      → THAY TOÀN BỘ rule của store (xoá hết ghi lại — màn Edit gửi trọn danh sách).
const slugLabel = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const storeId = String(req.nextUrl.searchParams.get("store") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return NextResponse.json({ ok: false, error: "store required" }, { status: 400 });
  const rules = await db.select().from(schema.feedLabelRules)
    .where(eq(schema.feedLabelRules.storeId, storeId)).orderBy(asc(schema.feedLabelRules.createdAt));
  // Danh sách collection của store cho dropdown — gom từ jsonb collections của sản phẩm.
  const prods = await db.select({ collections: schema.shopifyProducts.collections })
    .from(schema.shopifyProducts).where(eq(schema.shopifyProducts.storeId, storeId));
  const titles = new Set<string>();
  for (const pr of prods) for (const c of (Array.isArray(pr.collections) ? pr.collections : []) as { title?: string }[]) {
    const t = String(c?.title ?? "").trim(); if (t) titles.add(t);
  }
  return NextResponse.json({
    ok: true,
    rules: rules.map((r) => ({ id: r.id, collectionTitle: r.collectionTitle, label: r.label })),
    collections: Array.from(titles).sort(),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const storeId = String(b?.storeId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return NextResponse.json({ ok: false, error: "storeId required" }, { status: 400 });

  const rules = (Array.isArray(b?.rules) ? b.rules : [])
    .map((r: { collectionTitle?: string; label?: string }) => ({
      collectionTitle: String(r?.collectionTitle ?? "").trim().slice(0, 200),
      label: slugLabel(r?.label),
    }))
    .filter((r: { collectionTitle: string; label: string }) => r.collectionTitle && r.label)
    .slice(0, 50);

  await db.delete(schema.feedLabelRules).where(eq(schema.feedLabelRules.storeId, storeId));
  if (rules.length) {
    await db.insert(schema.feedLabelRules).values(rules.map((r: { collectionTitle: string; label: string }) => ({ storeId, ...r })));
  }
  return NextResponse.json({ ok: true, count: rules.length });
}
