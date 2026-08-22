import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { writeFile, fileUrl } from "@/lib/storage";
import { purifyMainImage } from "@/lib/amazon-mockup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/amazon-products/purify-image { url }
 * Tải ảnh mockup từ url (R2 của mình / Shopify / bất kỳ), chuẩn hóa thành ảnh MAIN Amazon
 * (nền trắng tuyệt đối + vuông 1600 + JPEG nhẹ), lưu lên R2, trả publicUrl.
 * Dùng cho nút "White-bg main" ở Manage Products Amazon. Chỉ level 2 products.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const url = String(b?.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return NextResponse.json({ ok: false, error: "url không hợp lệ" }, { status: 400 });

  let srcBuf: Buffer;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) return NextResponse.json({ ok: false, error: `Tải ảnh lỗi ${res.status}` }, { status: 400 });
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) return NextResponse.json({ ok: false, error: "URL không phải ảnh" }, { status: 400 });
    srcBuf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Không tải được ảnh: " + String((e as Error)?.message ?? e).slice(0, 120) }, { status: 400 });
  }

  let outBuf: Buffer;
  try {
    outBuf = await purifyMainImage(srcBuf);
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Xử lý ảnh lỗi: " + String((e as Error)?.message ?? e).slice(0, 120) }, { status: 500 });
  }

  const key = `amazon-mockup/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  await writeFile(key, outBuf, "image/jpeg");
  return NextResponse.json({ ok: true, url: fileUrl(key), key, bytes: outBuf.length });
}
