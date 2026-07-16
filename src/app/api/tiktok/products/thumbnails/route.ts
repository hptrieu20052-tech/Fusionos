import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { ttGetProductDetail } from "@/lib/tiktok-shop";
import { resolveProduct } from "@/lib/tiktok-products";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/tiktok/products/thumbnails  body { ids: string[] (row ids) }
// Lazy-load ảnh cho các dòng đang xem (search list không trả ảnh) → lấy từ Get Product Detail,
// đồng thời LƯU vào tiktok_products.main_image_url để lần sau có sẵn. Concurrency cap 5.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const ids = (Array.isArray(b.ids) ? b.ids : []).filter((x): x is string => typeof x === "string").slice(0, 30);

  const out: Record<string, string> = {};
  const queue = [...ids];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      if (!id) break;
      try {
        const r = await resolveProduct(session, id); // kèm scope check
        if (!r.ok) continue;
        const detail = await ttGetProductDetail(r.cfg, r.row.tiktokProductId);
        const imgs = (detail.main_images as { urls?: string[]; thumb_urls?: string[] }[] | undefined) ?? [];
        const url = imgs[0]?.urls?.[0] ?? imgs[0]?.thumb_urls?.[0];
        if (url) {
          out[id] = url;
          await db.update(schema.tiktokProducts).set({ mainImageUrl: url }).where(eq(schema.tiktokProducts.id, id));
        }
      } catch { /* bỏ qua ảnh lỗi, không chặn cả batch */ }
    }
  };
  await Promise.all(Array.from({ length: 5 }, () => worker()));
  return NextResponse.json({ ok: true, thumbs: out });
}
