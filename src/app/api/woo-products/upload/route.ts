import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { writeFile, fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/woo-products/upload — up ảnh sản phẩm từ máy → storage → trả URL public (v497).
 * Woo tự tải ảnh về Media Library của site khi tạo/sửa sản phẩm (images[].src).
 * body { dataUrl } (client đã nén ≤~4MB). Cần quyền products >= 2 (seller list được thì up được).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const dataUrl = String(b?.dataUrl ?? "");
  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!m) return NextResponse.json({ ok: false, error: "invalid image" }, { status: 400 });
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length || buf.length > 8_000_000) return NextResponse.json({ ok: false, error: "image too large (max 8MB)" }, { status: 400 });

  const ext = m[1].toLowerCase() === "png" ? "png" : m[1].toLowerCase() === "webp" ? "webp" : "jpg";
  const key = `woo/product-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    await writeFile(key, buf, `image/${ext === "jpg" ? "jpeg" : ext}`);
    return NextResponse.json({ ok: true, url: fileUrl(key) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
