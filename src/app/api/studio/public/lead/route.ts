import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getStudioSettings, corsJson, corsHeaders } from "@/lib/studio";

export const dynamic = "force-dynamic";

/**
 * POST /api/studio/public/lead — PUBLIC: gắn email vào preview đã gen ("Save your preview").
 * body { previewId, email }. Đây là máy thu LEAD: khách bỏ giỏ vẫn còn email + ảnh preview
 * để remarketing (xem danh sách trong Studio admin).
 */
export async function POST(req: NextRequest) {
  const st = await getStudioSettings();
  const b = await req.json().catch(() => null);
  const previewId = String(b?.previewId ?? "").trim();
  const email = String(b?.email ?? "").trim().toLowerCase().slice(0, 200);
  if (!/^[0-9a-f-]{36}$/i.test(previewId)) return corsJson(req, st.origins, { ok: false, error: "invalid preview" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return corsJson(req, st.origins, { ok: false, error: "Please enter a valid email" }, 400);
  try {
    await db.update(schema.studioPreviews).set({ email }).where(eq(schema.studioPreviews.id, previewId));
    return corsJson(req, st.origins, { ok: true });
  } catch (e) {
    return corsJson(req, st.origins, { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, 500);
  }
}

export async function OPTIONS(req: NextRequest) {
  const st = await getStudioSettings();
  return new NextResponse(null, { status: 204, headers: corsHeaders(req, st.origins) });
}
