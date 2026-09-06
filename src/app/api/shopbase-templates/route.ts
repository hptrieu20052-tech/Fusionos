import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * v405 · SHOPBASE TEMPLATES — CRUD, mirror /api/shopify-templates nhưng rút gọn:
 * ShopBase REST không có taxonomy/publications/metafields/theme suffix, nên template chỉ giữ
 * name/thumb/status/type/vendor + options/variants(giá theo tổ hợp) + collections [{id,title}].
 * Dùng cho flow Push Etsy/TikTok → ShopBase (stage bản nháp, options/variants/giá theo template;
 * collections áp lúc Push bằng POST collects.json).
 */
type TplOption = { name: string; values: string[] };
type TplVariant = { options: Record<string, string>; price: string; compareAtPrice?: string | null; sku?: string };
type TplCollection = { id: string; title: string };
type TplBody = {
  id?: string; storeId?: string; name?: string; thumbUrl?: string | null;
  options?: TplOption[]; variants?: TplVariant[]; collections?: TplCollection[];
  status?: string; productType?: string; vendor?: string;
  // v406 · description chuẩn + estimated delivery (ShopBase không chạy AI Optimize)
  description?: string;
  shipProcMin?: number | null; shipProcMax?: number | null;
  shipUsMin?: number | null; shipUsMax?: number | null;
  shipIntlMin?: number | null; shipIntlMax?: number | null;
  shipCutoffHour?: number | null;
  shipCountries?: Record<string, unknown>;   // { ca:[6,12], gb:[7,14], au:[8,16], de:[7,14] }
};

// 4 nước có ô riêng trong editor + widget. Nước khác ⇒ Rest of world (ship_intl_*).
const DELIVERY_COUNTRIES = ["ca", "gb", "au", "de"] as const;
// { ca:[6,12], … } — chỉ giữ nước trong danh sách và cặp số ĐẦY ĐỦ, thiếu 1 vế thì bỏ cả nước đó.

// Ô số ngày: rỗng/rác → null. Chặn số âm và số vô lý.
const clampDays = (v: unknown, max = 180): number | null => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Math.round(Number(v));
  if (!isFinite(n) || n < 0) return null;
  return Math.min(n, max);
};

function clampCountries(v: unknown): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  if (!v || typeof v !== "object") return out;
  const src = v as Record<string, unknown>;
  for (const cc of DELIVERY_COUNTRIES) {
    const a = src[cc];
    if (!Array.isArray(a)) continue;
    const lo = clampDays(a[0]), hi = clampDays(a[1]);
    if (lo == null || hi == null) continue;
    out[cc] = [Math.min(lo, hi), Math.max(lo, hi)];
  }
  return out;
}

// Store nào user được phép thao tác (ShopBase + trong scope)?
async function allowedStoreIds(session: Awaited<ReturnType<typeof getSession>>): Promise<Set<string>> {
  const scopeIds = await storeOwnerScopeIds(session!);
  const stores = await db.select({ id: schema.stores.id, seller: schema.stores.sellerId, mk: schema.stores.marketplace }).from(schema.stores);
  const ok = new Set<string>();
  for (const s of stores) if (s.mk === "shopbase" && (!scopeIds || (s.seller && scopeIds.includes(s.seller)))) ok.add(s.id);
  return ok;
}

const clampOptions = (v: unknown): TplOption[] =>
  (Array.isArray(v) ? v : []).slice(0, 3).map((o) => ({
    name: String((o as TplOption)?.name ?? "").trim().slice(0, 60),
    values: Array.isArray((o as TplOption)?.values) ? (o as TplOption).values.map((x) => String(x).trim()).filter(Boolean).slice(0, 100) : [],
  })).filter((o) => o.name && o.values.length);

const clampVariants = (v: unknown): TplVariant[] =>
  (Array.isArray(v) ? v : []).slice(0, 100).map((x) => {
    const o = x as TplVariant;
    const price = String(o?.price ?? "").trim();
    const cap = o?.compareAtPrice == null ? null : String(o.compareAtPrice).trim();
    return {
      options: (o?.options && typeof o.options === "object") ? Object.fromEntries(Object.entries(o.options).map(([k, val]) => [String(k), String(val)])) : {},
      price: /^\d+(\.\d+)?$/.test(price) ? Number(price).toFixed(2) : "0.00",
      compareAtPrice: cap && /^\d+(\.\d+)?$/.test(cap) ? Number(cap).toFixed(2) : null,
      sku: o?.sku ? String(o.sku).slice(0, 80) : "",
    };
  });

const clampCollections = (v: unknown): TplCollection[] =>
  (Array.isArray(v) ? v : []).slice(0, 50).map((x) => {
    const c = x as TplCollection;
    return { id: String(c?.id ?? "").trim().slice(0, 40), title: String(c?.title ?? "").trim().slice(0, 200) };
  }).filter((c) => c.id);

function payloadOf(b: TplBody) {
  return {
    name: String(b.name ?? "").trim().slice(0, 120) || "Untitled template",
    thumbUrl: (() => { const u = String(b.thumbUrl ?? "").trim().slice(0, 1000); return /^https?:\/\//i.test(u) ? u : null; })(),
    options: clampOptions(b.options),
    variants: clampVariants(b.variants),
    collections: clampCollections(b.collections),
    status: ["ACTIVE", "DRAFT", "ARCHIVED"].includes(String(b.status)) ? String(b.status) : "DRAFT",
    productType: String(b.productType ?? "").slice(0, 120) || null,
    vendor: String(b.vendor ?? "").slice(0, 120) || null,
    description: String(b.description ?? "").slice(0, 20000).trim() || null,
    // min/max tự đảo nếu người dùng gõ ngược (min 8, max 4 → 4..8).
    ...(() => {
      const pmin = clampDays(b.shipProcMin), pmax = clampDays(b.shipProcMax);
      const umin = clampDays(b.shipUsMin), umax = clampDays(b.shipUsMax);
      const imin = clampDays(b.shipIntlMin), imax = clampDays(b.shipIntlMax);
      const lo = (a: number | null, z: number | null) => (a != null && z != null ? Math.min(a, z) : a);
      const hi = (a: number | null, z: number | null) => (a != null && z != null ? Math.max(a, z) : z);
      return {
        shipProcMin: lo(pmin, pmax), shipProcMax: hi(pmin, pmax),
        shipUsMin: lo(umin, umax), shipUsMax: hi(umin, umax),
        shipIntlMin: lo(imin, imax), shipIntlMax: hi(imin, imax),
        shipCutoffHour: clampDays(b.shipCutoffHour, 23),
        shipCountries: clampCountries(b.shipCountries),
      };
    })(),
    updatedAt: new Date(),
  };
}

// GET /api/shopbase-templates?storeId=... → danh sách template (lọc theo store nếu có)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const allowed = await allowedStoreIds(session);
  const storeId = req.nextUrl.searchParams.get("storeId") ?? "";
  const rows = await db.select().from(schema.shopbaseTemplates).orderBy(desc(schema.shopbaseTemplates.updatedAt));
  const out = rows.filter((r) => allowed.has(r.storeId) && (!storeId || r.storeId === storeId));
  return NextResponse.json({ ok: true, templates: out });
}

// POST create
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as TplBody | null;
  const storeId = String(b?.storeId ?? "");
  const allowed = await allowedStoreIds(session);
  if (!allowed.has(storeId)) return NextResponse.json({ ok: false, error: "store not allowed" }, { status: 403 });
  const [row] = await db.insert(schema.shopbaseTemplates).values({ storeId, ...payloadOf(b!) }).returning();
  return NextResponse.json({ ok: true, template: row });
}

// PATCH update
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as TplBody | null;
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const [cur] = await db.select().from(schema.shopbaseTemplates).where(eq(schema.shopbaseTemplates.id, id)).limit(1);
  if (!cur) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const allowed = await allowedStoreIds(session);
  if (!allowed.has(cur.storeId)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const [row] = await db.update(schema.shopbaseTemplates).set(payloadOf(b!)).where(eq(schema.shopbaseTemplates.id, id)).returning();
  return NextResponse.json({ ok: true, template: row });
}

// DELETE { ids }
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 100);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  const rows = await db.select({ id: schema.shopbaseTemplates.id, storeId: schema.shopbaseTemplates.storeId }).from(schema.shopbaseTemplates).where(inArray(schema.shopbaseTemplates.id, ids));
  const allowed = await allowedStoreIds(session);
  const okIds = rows.filter((r) => allowed.has(r.storeId)).map((r) => r.id);
  if (!okIds.length) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  await db.delete(schema.shopbaseTemplates).where(inArray(schema.shopbaseTemplates.id, okIds));
  return NextResponse.json({ ok: true, deleted: okIds.length });
}
