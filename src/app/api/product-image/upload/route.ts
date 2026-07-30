import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { writeFile, fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/product-image/upload  (multipart: file)
 * Upload 1 ảnh từ máy lên R2 → trả URL công khai. Dùng cho Edit product (Etsy + Shopify):
 * thêm ảnh mới. Shopify Push sẽ tải ảnh từ URL này về (productCreateMedia originalSource).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: "bad form" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "missing file" }, { status: 400 });
  if (!/^image\//i.test(file.type)) return NextResponse.json({ ok: false, error: "Only image files" }, { status: 400 });
  // Vercel giới hạn body ~4.5MB → chặn 4MB; ảnh lớn hơn thì dùng "Add by URL".
  if (file.size > 4 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Image > 4MB — please compress, or use Add by URL" }, { status: 400 });

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  const key = `product-images/${randomUUID()}.${ext}`;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(key, buf, file.type || "image/jpeg");
  } catch (e) {
    return NextResponse.json({ ok: false, error: "storage: " + String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
  const url = fileUrl(key);
  if (!url || /^\/api\/uploads\/local/.test(url)) {
    return NextResponse.json({ ok: false, error: "Chưa cấu hình R2 công khai (R2_PUBLIC_URL) — Shopify cần URL công khai để tải ảnh. Tạm dùng Add by URL." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, url });
}
