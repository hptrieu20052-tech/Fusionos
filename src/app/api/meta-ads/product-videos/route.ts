import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, inArray, isNotNull, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * v674 · POST { ids: shopifyProducts.id[] } → map { [productId]: video[] } từ Video Library
 * (product_videos gắn product_id, chỉ lấy video có public_url — Meta cần URL tải được).
 * Dùng cho Meta Ads Kit: hiện ô video trong lưới thumbnail để chọn làm creative.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null) as { ids?: unknown[] } | null;
  const ids = Array.from(new Set((Array.isArray(b?.ids) ? b!.ids! : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))).slice(0, 40);
  if (!ids.length) return NextResponse.json({ ok: true, videos: {} });
  const rows = await db.select({
    productId: schema.productVideos.productId, code: schema.productVideos.videoCode,
    title: schema.productVideos.title, thumbUrl: schema.productVideos.thumbUrl, publicUrl: schema.productVideos.publicUrl,
  }).from(schema.productVideos)
    .where(and(inArray(schema.productVideos.productId, ids), isNotNull(schema.productVideos.publicUrl)))
    .orderBy(desc(schema.productVideos.videoCode));
  const out: Record<string, { code: number; title: string; thumbUrl: string | null; publicUrl: string }[]> = {};
  for (const r of rows) {
    const pid = String(r.productId ?? "");
    if (!pid || !r.publicUrl) continue;
    const arr = out[pid] ?? (out[pid] = []);
    if (arr.length < 8) arr.push({ code: r.code, title: r.title, thumbUrl: r.thumbUrl, publicUrl: r.publicUrl });
  }
  return NextResponse.json({ ok: true, videos: out });
}
