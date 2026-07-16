import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { ttUploadProductImage } from "@/lib/tiktok-shop";
import { resolveProduct } from "@/lib/tiktok-products";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/tiktok/products/[id]/upload-image (multipart: file) → upload mockup lên shop của product → { uri, url }.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const r = await resolveProduct(session, params.id);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "missing file" }, { status: 400 });
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Image > 5MB, please reduce the size" }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { uri, url } = await ttUploadProductImage(r.cfg, bytes, file.name || "mockup.jpg", "MAIN_IMAGE");
    if (!uri) return NextResponse.json({ ok: false, error: "upload returned no uri" }, { status: 500 });
    return NextResponse.json({ ok: true, uri, url });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
