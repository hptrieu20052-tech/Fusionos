import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { orGenerateImage } from "@/lib/ai/openrouter";
import { seedreamEdit } from "@/lib/ai/fal";
import { writeFile, fileUrl } from "@/lib/storage";
import { getStudioSettings, corsJson, corsHeaders, clientIp, watermarkImage } from "@/lib/studio";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Seedream cần image_size tuyệt đối thay vì aspect ratio.
function ratioToSize(r?: string): { width: number; height: number } | undefined {
  const M: Record<string, [number, number]> = { "1:1": [1, 1], "4:5": [4, 5], "3:4": [3, 4], "2:3": [2, 3], "16:9": [16, 9], "9:16": [9, 16] };
  const ab = M[r ?? ""]; if (!ab) return undefined;
  const [a, b] = ab, base = 2048;
  return a >= b ? { width: base, height: Math.round((base * b) / a) } : { width: Math.round((base * a) / b), height: base };
}

/**
 * POST /api/studio/public/generate — PUBLIC: gen COVER PREVIEW cho khách trên talewix.com.
 * body { templateId, name, photo (dataURL jpeg/png ≤ ~4MB — client đã downscale), email? }
 *
 * Chống lạm dụng: (1) origin CORS theo settings, (2) rate limit theo IP/24h + trần toàn hệ/24h
 * (đếm bảng studio_previews), (3) watermark đóng thẳng vào ảnh trả về.
 * Model do admin chọn trong Studio Settings — fal-ai/* → Seedream, còn lại → OpenRouter.
 */
export async function POST(req: NextRequest) {
  const st = await getStudioSettings();
  const J = (body: unknown, status = 200) => corsJson(req, st.origins, body, status);
  if (!st.enabled) return J({ ok: false, error: "Studio is temporarily unavailable" }, 503);

  const b = await req.json().catch(() => null);
  const templateId = String(b?.templateId ?? "").trim();
  const name = String(b?.name ?? "").trim().slice(0, 40);
  const photo = String(b?.photo ?? "").trim();
  const email = String(b?.email ?? "").trim().slice(0, 200);
  if (!/^[0-9a-f-]{36}$/i.test(templateId)) return J({ ok: false, error: "invalid template" }, 400);
  if (!name) return J({ ok: false, error: "Please enter the child's name" }, 400);
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(photo)) return J({ ok: false, error: "Please upload a photo" }, 400);
  if (photo.length > 6_000_000) return J({ ok: false, error: "Photo too large — please use a smaller image" }, 400);

  const [tpl] = await db.select().from(schema.studioTemplates)
    .where(and(eq(schema.studioTemplates.id, templateId), eq(schema.studioTemplates.active, true))).limit(1);
  if (!tpl) return J({ ok: false, error: "template not found" }, 404);
  if (!tpl.baseImageUrl) return J({ ok: false, error: "template not configured" }, 500);

  // ── Rate limit theo bảng previews (24h) ───────────────────────────────────
  const ip = clientIp(req);
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  try {
    const [byIp] = await db.select({ n: sql<number>`count(*)` }).from(schema.studioPreviews)
      .where(and(eq(schema.studioPreviews.ip, ip), gte(schema.studioPreviews.createdAt, since)));
    if (Number(byIp?.n ?? 0) >= st.dailyLimitIp) return J({ ok: false, error: "Daily preview limit reached — please try again tomorrow, or contact us." }, 429);
    const [all] = await db.select({ n: sql<number>`count(*)` }).from(schema.studioPreviews)
      .where(gte(schema.studioPreviews.createdAt, since));
    if (Number(all?.n ?? 0) >= st.dailyLimitGlobal) return J({ ok: false, error: "We're experiencing high demand — please try again later." }, 429);
  } catch { /* bảng chưa migrate → bỏ qua limit (route vẫn chạy) */ }

  // ── Gen ảnh: prompt chung (settings) + dặn riêng template; refs = [cover template, ảnh mặt] ──
  const prompt = st.prompt.split("{name}").join(name) + (tpl.promptExtra?.trim() ? `\n\n${tpl.promptExtra.trim()}` : "");
  const refs = [tpl.baseImageUrl, photo];

  let b64 = "", cost = 0, errMsg = "";
  try {
    const out = st.model.startsWith("fal-ai/")
      ? await seedreamEdit(prompt, refs, { ...(ratioToSize(st.aspectRatio) ? { imageSize: ratioToSize(st.aspectRatio)! } : {}) })
      : await orGenerateImage(prompt, refs, { outputFormat: "png", model: st.model, aspectRatio: st.aspectRatio });
    b64 = out.b64; cost = out.cost;
  } catch (e) {
    errMsg = String((e as Error)?.message ?? e).slice(0, 300);
  }

  if (!b64) {
    // Ghi lại lần lỗi (vẫn tính vào rate limit để không spam model đắt tiền).
    try {
      await db.insert(schema.studioPreviews).values({
        templateId, childName: name, email, model: st.model, ip, status: "error", error: errMsg,
      });
    } catch { /* ignore */ }
    return J({ ok: false, error: "Preview generation failed — please try again in a minute." }, 502);
  }

  try {
    const marked = await watermarkImage(Buffer.from(b64, "base64"), st.watermark);
    const [row] = await db.insert(schema.studioPreviews).values({
      templateId, childName: name, email, model: st.model, cost: String(cost), ip, status: "done",
    }).returning({ id: schema.studioPreviews.id });
    const key = `studio/preview-${row.id}.png`;
    await writeFile(key, marked, "image/png");
    await db.update(schema.studioPreviews).set({ previewKey: key }).where(eq(schema.studioPreviews.id, row.id));
    return J({ ok: true, previewId: row.id, url: fileUrl(key) });
  } catch (e) {
    return J({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, 500);
  }
}

export async function OPTIONS(req: NextRequest) {
  const st = await getStudioSettings();
  return new NextResponse(null, { status: 204, headers: corsHeaders(req, st.origins) });
}
