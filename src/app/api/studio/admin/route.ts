import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
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
    // v602 · search nhận cả ID: uuid FUSION của listing (dán từ cột ID bảng Manage Products) tìm
    // ĐÍCH DANH (bỏ lọc status); chuỗi số ≥8 = Shopify product id HOẶC variant id; còn lại theo title.
    const cond = /^[0-9a-f-]{36}$/i.test(q)
      ? eq(schema.shopifyProducts.id, q)
      : /^\d{8,}$/.test(q)
      ? and(sql`(${schema.shopifyProducts.shopifyProductId} LIKE ${"%" + q} OR ${schema.shopifyProducts.variants}::text LIKE ${"%" + q + "%"})`,
          inArray(schema.shopifyProducts.status, ["ACTIVE", "UNLISTED"]))
      // v491 · nhận cả UNLISTED — bản "Photo Edition" cố tình để Unlisted (mua được qua wizard,
      // ẩn khỏi search/collection của store) nên không được lọc mất khỏi picker.
      : and(ilike(schema.shopifyProducts.title, `%${q}%`), inArray(schema.shopifyProducts.status, ["ACTIVE", "UNLISTED"]));
    const rows = await db.select({
      id: schema.shopifyProducts.id, title: schema.shopifyProducts.title,
      images: schema.shopifyProducts.images, variants: schema.shopifyProducts.variants,
      status: schema.shopifyProducts.status, url: schema.shopifyProducts.onlineStoreUrl,
      bodyHtml: schema.shopifyProducts.bodyHtml, // v490 · auto-fill description cho trang chi tiết wizard
    }).from(schema.shopifyProducts)
      .where(cond)
      .orderBy(desc(schema.shopifyProducts.updatedAt)).limit(20);
    const products = rows.map((r) => {
      const imgs = (Array.isArray(r.images) ? r.images : []) as Img[];
      // v602 · TẤT CẢ ảnh listing (theo position) — auto-fill gallery cho trang chi tiết wizard.
      const imageUrls = imgs.slice().sort((a, b) => (a?.position ?? 99) - (b?.position ?? 99))
        .map((i) => String(i?.src ?? "")).filter((s) => /^https?:/i.test(s)).slice(0, 12);
      const thumb = imageUrls[0] ?? "";
      const vars = ((Array.isArray(r.variants) ? r.variants : []) as Vari[]).map((v) => ({
        id: String(v?.id ?? "").replace(/\D/g, ""),         // GID → id số cho /cart/add.js
        title: String(v?.title ?? "Default"), price: String(v?.price ?? ""),
      })).filter((v) => v.id);
      const desc = String(r.bodyHtml ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 400);
      return { id: r.id, title: r.title, thumb, url: r.url, variants: vars, desc, imageUrls };
    });
    return NextResponse.json({ ok: true, products });
  }

  const settings = await getStudioSettings();
  // v600 · danh sách seller cho dropdown Assign seller trên tab Templates.
  let sellers: { id: string; name: string | null }[] = [];
  try {
    sellers = await db.select({ id: schema.users.id, name: schema.users.fullName })
      .from(schema.users).where(eq(schema.users.role, "seller"));
  } catch { /* phụ */ }
  let templates: unknown[] = [], leads: unknown[] = [];
  try {
    templates = await db.select().from(schema.studioTemplates)
      .orderBy(asc(schema.studioTemplates.sort), asc(schema.studioTemplates.createdAt));
    const rows = await db.select({
      id: schema.studioPreviews.id, templateId: schema.studioPreviews.templateId,
      childName: schema.studioPreviews.childName, email: schema.studioPreviews.email,
      previewKey: schema.studioPreviews.previewKey, photoKey: schema.studioPreviews.photoKey,
      cleanKey: schema.studioPreviews.cleanKey, // v605 · bìa sạch không watermark (seller dùng in)
      model: schema.studioPreviews.model,
      cost: schema.studioPreviews.cost, ip: schema.studioPreviews.ip,
      status: schema.studioPreviews.status, error: schema.studioPreviews.error,
      createdAt: schema.studioPreviews.createdAt,
    }).from(schema.studioPreviews).orderBy(desc(schema.studioPreviews.createdAt)).limit(100);
    leads = rows.map((r) => ({ ...r, previewUrl: r.previewKey ? fileUrl(r.previewKey) : null, photoUrl: r.photoKey ? fileUrl(r.photoKey) : null, cleanUrl: r.cleanKey ? fileUrl(r.cleanKey) : null }));
  } catch { /* bảng chưa migrate → trả rỗng, UI hiện hướng dẫn chạy SQL */ }
  return NextResponse.json({ ok: true, settings, defaults: defaultStudioSettings(), templates, leads, sellers });
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

type TplVariant = { id?: string; title?: string; price?: string };
type TplBody = { id?: string; title?: string; thumbUrl?: string; baseImageUrl?: string; variantId?: string; price?: string; promptExtra?: string; active?: boolean; sort?: number; variants?: TplVariant[]; description?: string; ageRange?: string; pages?: string; backImageUrl?: string; genBack?: boolean; sellerId?: string | null; galleryImages?: unknown[] };
function tplFields(t: TplBody) {
  // v488 · variants: danh sách size/paper cho khách chọn trong wizard (picker tự nạp khi chọn sản phẩm).
  const variants = (Array.isArray(t.variants) ? t.variants : []).map((v) => ({
    id: String(v?.id ?? "").replace(/\D/g, ""),
    title: String(v?.title ?? "").trim().slice(0, 120),
    price: String(v?.price ?? "").trim().slice(0, 20),
  })).filter((v) => v.id).slice(0, 30);
  return {
    title: String(t.title ?? "").trim().slice(0, 200),
    thumbUrl: String(t.thumbUrl ?? "").trim(),
    baseImageUrl: String(t.baseImageUrl ?? t.thumbUrl ?? "").trim(),
    variantId: String(t.variantId ?? "").trim(),
    price: String(t.price ?? "").trim().slice(0, 20),
    promptExtra: String(t.promptExtra ?? "").slice(0, 2000),
    active: t.active !== false,
    sort: Number(t.sort) || 0,
    variants,
    description: String(t.description ?? "").slice(0, 2000),
    ageRange: String(t.ageRange ?? "").trim().slice(0, 40),
    pages: String(t.pages ?? "").trim().slice(0, 10),
    backImageUrl: String(t.backImageUrl ?? "").trim(),
    genBack: t.genBack === true,
    // v600 · seller của template — uuid hợp lệ hoặc null (bỏ gán).
    sellerId: /^[0-9a-f-]{36}$/i.test(String(t.sellerId ?? "")) ? String(t.sellerId) : null,
    // v602 · gallery ảnh listing (trang chi tiết wizard) — tối đa 12 URL http(s).
    galleryImages: (Array.isArray(t.galleryImages) ? t.galleryImages : []).map((u) => String(u).trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 12),
  };
}

// v600 · Gán seller cho template → ĐÓNG DẤU luôn created_by lên listing Shopify chứa variant đó.
// Nhờ vậy đơn khách đặt qua wizard (add-to-cart variant này) được webhook v597 chia đúng seller,
// và Spend by seller bên Meta Ads cũng nhìn thấy chủ listing. Best-effort — lỗi không chặn Save.
async function stampOwnerByVariant(variantId: string, sellerId: string | null): Promise<number> {
  if (!sellerId) return 0;
  const vid = String(variantId ?? "").replace(/\D/g, "");
  if (!vid) return 0;
  try {
    const r = (await db.execute(sql`
      UPDATE shopify_products SET created_by = ${sellerId}::uuid, updated_at = now()
      WHERE variants::text LIKE ${"%" + vid + "%"}
      RETURNING id`)).rows;
    return r.length;
  } catch { return 0; }
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const f = tplFields((b?.template ?? {}) as TplBody);
  if (!f.title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
  try {
    const [row] = await db.insert(schema.studioTemplates).values(f).returning();
    const stamped = await stampOwnerByVariant(f.variantId, f.sellerId);
    return NextResponse.json({ ok: true, template: row, stamped });
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
    const stamped = await stampOwnerByVariant(f.variantId, f.sellerId);
    return NextResponse.json({ ok: true, stamped });
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
