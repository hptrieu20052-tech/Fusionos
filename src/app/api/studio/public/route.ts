import { NextRequest } from "next/server";
import { db, schema } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { getStudioSettings, corsJson, corsHeaders } from "@/lib/studio";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/studio/public — PUBLIC (không login): cấu hình wizard cho page Create Your Own
 * trên talewix.com. Chỉ trả field khách được thấy (không lộ prompt/model/limit).
 */
export async function GET(req: NextRequest) {
  const st = await getStudioSettings();
  if (!st.enabled) return corsJson(req, st.origins, { ok: false, error: "studio is disabled" }, 503);
  try {
    const rows = await db.select({
      id: schema.studioTemplates.id, title: schema.studioTemplates.title,
      thumbUrl: schema.studioTemplates.thumbUrl, price: schema.studioTemplates.price,
      variantId: schema.studioTemplates.variantId,
      variants: schema.studioTemplates.variants, // v488 · khách chọn size/paper trong wizard
      description: schema.studioTemplates.description, ageRange: schema.studioTemplates.ageRange,
      pages: schema.studioTemplates.pages,       // v490 · trang chi tiết trong wizard
    }).from(schema.studioTemplates)
      .where(eq(schema.studioTemplates.active, true))
      .orderBy(asc(schema.studioTemplates.sort), asc(schema.studioTemplates.createdAt));
    return corsJson(req, st.origins, { ok: true, templates: rows });
  } catch (e) {
    return corsJson(req, st.origins, { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, 500);
  }
}

export async function OPTIONS(req: NextRequest) {
  const st = await getStudioSettings();
  return new NextResponse(null, { status: 204, headers: corsHeaders(req, st.origins) });
}
