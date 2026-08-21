import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getUploadTarget, fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * POST /api/amazon-products/image-url { filename, contentType }
 * → presigned PUT để browser đẩy ảnh thẳng lên R2 + publicUrl để lưu vào bộ ảnh Amazon.
 * Dùng cho khối "Amazon images" (ảnh main nền trắng...) — ảnh nằm ở R2, không đụng Shopify.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ct = String(b?.contentType ?? "");
  if (!ct.startsWith("image/")) return NextResponse.json({ ok: false, error: "Image files only" }, { status: 400 });
  const ext = (String(b?.filename ?? "").match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ".jpg").toLowerCase();
  const key = `amazon-images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const target = await getUploadTarget(key, ct);
  return NextResponse.json({ ok: true, key, publicUrl: fileUrl(key), ...target });
}
