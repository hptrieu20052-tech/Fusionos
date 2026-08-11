import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

type TplOption = { name: string; values: string[] };
// Câu hỏi personalization — copy đúng mô hình Etsy đang cho seller setup:
//   text     : question_text ≤45 · instructions ≤120 · required · max_allowed_characters 1-1024
//   dropdown : question_text ≤45 · required · options 1-30, mỗi option ≤20 ký tự (Etsy KHÔNG cho instructions)
//   upload   : question_text ≤45 · instructions ≤120 · required · max_allowed_files 1-10
//              options rỗng = upload không nhãn; options có nhãn = labeled upload (mỗi nhãn 1 ô file)
// Giới hạn: tối đa 5 câu/listing, tối đa 1 câu upload.
type PQ = { type: "text" | "dropdown" | "upload"; label: string; instructions: string; required: boolean; maxChars: number; options: string[]; maxFiles: number };
type TplVariant = { options: Record<string, string>; price: string; compareAtPrice?: string | null; sku?: string };
type TplBody = {
  id?: string; storeId?: string; name?: string; thumbUrl?: string | null;
  options?: TplOption[]; variants?: TplVariant[];
  collectionIds?: string[]; publicationIds?: string[];
  status?: string; productType?: string; vendor?: string; themeTemplate?: string;
  category?: { id: string; name: string } | null;
  categoryMetafields?: { namespace: string; key: string; type: string; value: string; label?: string; valueLabel?: string }[];
  baseDescription?: string; productDetails?: string; shippingInfo?: string;
  personalization?: unknown;                 // PQ[] — ô khách điền trên trang sản phẩm
  // Estimated delivery — số NGÀY LÀM VIỆC cho widget trên trang sản phẩm
  shipProcMin?: number | null; shipProcMax?: number | null;
  shipUsMin?: number | null; shipUsMax?: number | null;
  shipIntlMin?: number | null; shipIntlMax?: number | null;
  shipCutoffHour?: number | null;
  shipCountries?: Record<string, unknown>;   // { ca:[6,12], gb:[7,14], au:[8,16], de:[7,14] }
};

// 4 nước có ô riêng trong Template + trong widget. Nước khác ⇒ Rest of world (ship_intl_*).
// KHÔNG export: file route.ts của Next.js chỉ cho export GET/POST/PATCH/DELETE/dynamic/maxDuration…
// export thêm biến lạ ⇒ build fail "is not a valid Route export field".
const DELIVERY_COUNTRIES = ["ca", "gb", "au", "de"] as const;

// Ô số ngày: rỗng/rác → null (widget dùng số mặc định của nó). Chặn số âm và số vô lý.
const clampDays = (v: unknown, max = 180): number | null => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Math.round(Number(v));
  if (!isFinite(n) || n < 0) return null;
  return Math.min(n, max);
};

// { ca:[6,12], … } — chỉ giữ nước trong danh sách và cặp số ĐẦY ĐỦ, thiếu 1 vế thì bỏ cả nước đó.
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

// Store nào user được phép thao tác (Shopify + trong scope)?
async function allowedStoreIds(session: Awaited<ReturnType<typeof getSession>>): Promise<Set<string>> {
  const scopeIds = await storeOwnerScopeIds(session!);
  const stores = await db.select({ id: schema.stores.id, seller: schema.stores.sellerId, mk: schema.stores.marketplace }).from(schema.stores);
  const ok = new Set<string>();
  for (const s of stores) if (s.mk === "shopify" && (!scopeIds || (s.seller && scopeIds.includes(s.seller)))) ok.add(s.id);
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

// Chuẩn hoá + siết đúng luật Etsy. Câu nào không có label thì bỏ hẳn — ô không nhãn ra tới
// storefront là đơn về không biết khách điền gì.
function clampPersonalization(v: unknown): PQ[] {
  const src = Array.isArray(v) ? v : [];
  const out: PQ[] = [];
  let uploadUsed = false;
  for (const x of src) {
    const q = x as Partial<PQ>;
    const type: PQ["type"] = q?.type === "dropdown" ? "dropdown" : q?.type === "upload" ? "upload" : "text";
    if (type === "upload") { if (uploadUsed) continue; uploadUsed = true; }   // Etsy: tối đa 1 câu upload
    const label = String(q?.label ?? "").trim().slice(0, 45);
    if (!label) continue;
    // options: dropdown ≤20 ký tự/option (luật Etsy); labeled upload dùng nhãn dài hơn nên cho 45.
    const optCap = type === "dropdown" ? 20 : 45;
    const options = (Array.isArray(q?.options) ? q!.options! : [])
      .map((s) => String(s).trim().slice(0, optCap)).filter(Boolean).slice(0, 30);
    if (type === "dropdown" && !options.length) continue;                     // dropdown rỗng = ô chết
    const maxChars = Math.min(Math.max(Math.round(Number(q?.maxChars) || 0) || 100, 1), 1024);
    const maxFiles = Math.min(Math.max(Math.round(Number(q?.maxFiles) || 0) || 1, 1), 10);
    out.push({
      type, label,
      instructions: type === "dropdown" ? "" : String(q?.instructions ?? "").trim().slice(0, 120),
      required: !!q?.required,
      maxChars: type === "text" ? maxChars : 0,
      options,
      maxFiles: type === "upload" ? (options.length ? options.length : maxFiles) : 0,
    });
    if (out.length >= 5) break;                                               // Etsy: tối đa 5 câu
  }
  return out;
}

const clampMeta = (v: unknown) =>
  (Array.isArray(v) ? v : []).slice(0, 20).map((x) => {
    const m = x as { namespace?: string; key?: string; type?: string; value?: string; label?: string; valueLabel?: string };
    return { namespace: String(m?.namespace ?? "shopify").slice(0, 40), key: String(m?.key ?? "").slice(0, 60), type: String(m?.type ?? "single_line_text_field").slice(0, 40), value: String(m?.value ?? ""), label: String(m?.label ?? ""), valueLabel: String(m?.valueLabel ?? "") };
  }).filter((m) => m.key);

function payloadOf(b: TplBody) {
  return {
    name: String(b.name ?? "").trim().slice(0, 120) || "Untitled template",
    // Ảnh mẫu — chỉ nhận URL http(s), cắt 1000 ký tự; rác/rỗng → null (list hiện ô placeholder).
    thumbUrl: (() => { const u = String(b.thumbUrl ?? "").trim().slice(0, 1000); return /^https?:\/\//i.test(u) ? u : null; })(),
    options: clampOptions(b.options),
    variants: clampVariants(b.variants),
    collectionIds: (Array.isArray(b.collectionIds) ? b.collectionIds : []).map(String).filter((s) => /^gid:\/\/shopify\/Collection\//.test(s)).slice(0, 50),
    publicationIds: (Array.isArray(b.publicationIds) ? b.publicationIds : []).map(String).filter((s) => /^gid:\/\/shopify\//.test(s)).slice(0, 50),
    status: ["ACTIVE", "DRAFT", "ARCHIVED"].includes(String(b.status)) ? String(b.status) : "DRAFT",
    productType: String(b.productType ?? "").slice(0, 120) || null,
    vendor: String(b.vendor ?? "").slice(0, 120) || null,
    themeTemplate: String(b.themeTemplate ?? "").slice(0, 120) || null,
    category: (b.category && typeof b.category === "object" && b.category.id) ? { id: String(b.category.id), name: String(b.category.name ?? "") } : null,
    categoryMetafields: clampMeta(b.categoryMetafields),
    baseDescription: String(b.baseDescription ?? "").slice(0, 6000).trim() || null,
    productDetails: String(b.productDetails ?? "").slice(0, 6000).trim() || null,
    shippingInfo: String(b.shippingInfo ?? "").slice(0, 6000).trim() || null,
    personalization: clampPersonalization(b.personalization),
    // Số ngày giao hàng — max/min tự đảo nếu người dùng gõ ngược (min 8, max 4 → 4..8).
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

// GET /api/shopify-templates?storeId=... → danh sách template (lọc theo store nếu có)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const allowed = await allowedStoreIds(session);
  const storeId = req.nextUrl.searchParams.get("storeId") ?? "";
  const rows = await db.select().from(schema.shopifyTemplates).orderBy(desc(schema.shopifyTemplates.updatedAt));
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
  const [row] = await db.insert(schema.shopifyTemplates).values({ storeId, ...payloadOf(b!) }).returning();
  return NextResponse.json({ ok: true, template: row });
}

// PATCH update
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as TplBody | null;
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const [cur] = await db.select().from(schema.shopifyTemplates).where(eq(schema.shopifyTemplates.id, id)).limit(1);
  if (!cur) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const allowed = await allowedStoreIds(session);
  if (!allowed.has(cur.storeId)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const [row] = await db.update(schema.shopifyTemplates).set(payloadOf(b!)).where(eq(schema.shopifyTemplates.id, id)).returning();
  return NextResponse.json({ ok: true, template: row });
}

// DELETE { ids }
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 100);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  const rows = await db.select({ id: schema.shopifyTemplates.id, storeId: schema.shopifyTemplates.storeId }).from(schema.shopifyTemplates).where(inArray(schema.shopifyTemplates.id, ids));
  const allowed = await allowedStoreIds(session);
  const okIds = rows.filter((r) => allowed.has(r.storeId)).map((r) => r.id);
  if (!okIds.length) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  await db.delete(schema.shopifyTemplates).where(inArray(schema.shopifyTemplates.id, okIds));
  return NextResponse.json({ ok: true, deleted: okIds.length });
}
