import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { ttGetProductDetail } from "@/lib/tiktok-shop";
import { resolveProduct, summarizeDetail } from "@/lib/tiktok-products";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/tiktok/products/[id]/detail — lấy detail LIVE từ TikTok để dựng form review (clone/edit).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const r = await resolveProduct(session, params.id);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  try {
    const detail = await ttGetProductDetail(r.cfg, r.row.tiktokProductId);
    return NextResponse.json({ ok: true, storeName: r.store.name, tiktokProductId: r.row.tiktokProductId, summary: summarizeDetail(detail) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
