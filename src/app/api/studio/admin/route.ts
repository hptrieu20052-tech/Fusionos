import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, asc, desc, eq, ilike } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { getStudioSettings, saveStudioSettings, defaultStudioSettings, type StudioSettings } from "@/lib/studio";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * /api/studio/admin — ADMIN ONLY: quản lý Studio "Create Your Own".
 *   GET               → { settings, defaults, templates, leads (100 preview mới nhất) }
 *   PATCH {settings}  → lưu settings (model, limit, watermark, origins, prompt…)
 *   POST  {template}  → tạo template
 *   PUT   {template}  → sửa template (theo id)
 *   DELETE ?id=       → xoá template
 */
async function requireAdmin() {
  const s = await getSession();
  if (!s || s.role !== "admin") return null;
  return s;
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // ?search=<q> → PICKER: tìm sản phẩm Shopify đã sync trong FUSION để nạp làm template
  // (tự điền title / ảnh cover / variant / giá — admin không phải dán tay URL + variant ID).
  const q = String(req.nextUrl.searchParams.get("search") ?? "").trim();
  if (q) {
    type Img = { src?: string; position?: number };
    type Vari = { id?: string; title?: string; price?: string };
    const rows = await db.select({
      id: schema.shopifyProducts.id, title: schema.shopifyProducts.title,
      images: schema.shopifyProducts.images, variants: schema.shopifyProducts.variants,
      status: schema.shopifyProducts.status, url: schema.shopifyProducts.onlineStoreUrl,
    }).from(schema.shopifyProducts)
      .where(and(ilike(schema.shopifyProducts.title, `%${q}%`), eq(schema.shopifyProducts.status, "ACTIVE")))
      .orderBy(desc(schema.shopifyProducts.updatedAt)).limit(20);
    const products = rows.map((r) => {
      const imgs = (Array.isArray(r.images) ? r.images : []) as Img[];
      const thumb = imgs.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99)).map((i) => String(i?.src ?? "")).find((s) => /^https?:/i.test(s)) ?? "";
      const vars = ((Array.isArray(r.variants) ? r.variants : []) as Vari[]).map((v) => ({
        id: String(v?.id ?? "").replace(/\D/g, ""),         // GID → id số cho /cart/add.js
        title: String(v?.title ?? "Default"), price: String(v?.price ?? ""),
      })).filter((v) => v.id);
      return { id: r.id, title: r.title, thumb, url: r.url, variants: vars };
    });
    return NextResponse.json({ ok: true, products });
  }

  const settings = await getStudioSettings();
  let templates: unknown[] = [], leads: unknown[] = [];
  try {
    templates = await db.select().from(schema.studioTemplates)
      .orderBy(asc(schema.studioTemplates.sort), asc(schema.studioTemplates.createdAt));
    const rows = await db.select({
      id: schema.studioPreviews.id, templateId: schema.studioPreviews.templateId,
      childName: schema.studioPreviews.childName, email: schema.studioPreviews.email,
      previewKey: schema.studioPreviews.previewKey, model: schema.studioPreviews.model,
      cost: schema.studioPreviews.cost, ip: schema.studioPreviews.ip,
      status: schema.studioPreviews.status, error: schema.studioPreviews.error,
      createdAt: schema.studioPreviews.createdAt,
    }).from(schema.studioPreviews).orderBy(desc(schema.studioPreviews.createdAt)).limit(100);
    leads = rows.map((r) => ({ ...r, previewUrl: r.previewKey ? fileUrl(r.previewKey) : null }));
  } catch { /* bảng chưa migrate → trả rỗng, UI hiện hướng dẫn chạy SQL */ }
  return NextResponse.json({ ok: true, settings, defaults: defaultStudioSettings(), templates, leads });
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const s = (b?.settings ?? {}) as Partial<StudioSettings>;
  const patch: Partial<StudioSettings> = {};
  if (typeof s.enabled === "boolean") patch.enabled = s.enabled;
  if (typeof s.model === "string") patch.model = s.model.trim();
  if (typeof s.aspectRatio === "string") patch.aspectRatio = s.aspectRatio;
  if (s.dailyLimitIp != null) patch.dailyLimitIp = Math.max(1, Math.min(100, Number(s.dailyLimitIp) || 5));
  if (s.dailyLimitGlobal != null) patch.dailyLimitGlobal = Math.max(10, Math.min(10000, Number(s.dailyLimitGlobal) || 300));
  if (typeof s.watermark === "string") patch.watermark = s.watermark.slice(0, 60);
  if (Array.isArray(s.origins)) patch.origins = s.origins.map((o) => String(o).trim()).filter(Boolean).slice(0, 10);
  if (typeof s.prompt === "string" && s.prompt.trim()) patch.prompt = s.prompt;
  try {
    const settings = await saveStudioSettings(patch);
    return NextResponse.json({ ok: true, settings });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}

type TplBody = { id?: string; title?: string; thumbUrl?: string; baseImageUrl?: string; variantId?: string; price?: string; promptExtra?: string; active?: boolean; sort?: number };
function tplFields(t: TplBody) {
  return {
    title: String(t.title ?? "").trim().slice(0, 200),
    thumbUrl: String(t.thumbUrl ?? "").trim(),
    baseImageUrl: String(t.baseImageUrl ?? t.thumbUrl ?? "").trim(),
    variantId: String(t.variantId ?? "").trim(),
    price: String(t.price ?? "").trim().slice(0, 20),
    promptExtra: String(t.promptExtra ?? "").slice(0, 2000),
    active: t.active !== false,
    sort: Number(t.sort) || 0,
  };
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const f = tplFields((b?.template ?? {}) as TplBody);
  if (!f.title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
  try {
    const [row] = await db.insert(schema.studioTemplates).values(f).returning();
    return NextResponse.json({ ok: true, template: row });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const t = (b?.template ?? {}) as TplBody;
  const id = String(t.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  const f = tplFields(t);
  if (!f.title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
  try {
    await db.update(schema.studioTemplates).set({ ...f, updatedAt: new Date() }).where(eq(schema.studioTemplates.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const id = String(req.nextUrl.searchParams.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  try {
    // Preview cũ giữ lại làm lead — chỉ gỡ liên kết template rồi xoá.
    await db.update(schema.studioPreviews).set({ templateId: null }).where(eq(schema.studioPreviews.templateId, id));
    await db.delete(schema.studioTemplates).where(eq(schema.studioTemplates.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
