import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { ttActivateProducts, ttDeactivateProducts, ttDeleteProducts } from "@/lib/tiktok-shop";
import { resolveProduct } from "@/lib/tiktok-products";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/tiktok/products/[id]/lifecycle — { action: "activate" | "deactivate" | "delete" }
// Deactivate = gỡ bán (giữ listing, có thể bật lại). Activate = bán lại. Delete = xóa listing (không khôi phục qua API).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const r = await resolveProduct(session, params.id);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });

  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = b.action;
  if (action !== "activate" && action !== "deactivate" && action !== "delete") {
    return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
  }

  try {
    const pid = r.row.tiktokProductId;
    if (action === "activate") {
      await ttActivateProducts(r.cfg, [pid]);
      await db.update(schema.tiktokProducts).set({ status: "ACTIVATE", syncedAt: sql`now()` }).where(eq(schema.tiktokProducts.id, r.row.id));
    } else if (action === "deactivate") {
      await ttDeactivateProducts(r.cfg, [pid]);
      await db.update(schema.tiktokProducts).set({ status: "SELLER_DEACTIVATED", syncedAt: sql`now()` }).where(eq(schema.tiktokProducts.id, r.row.id));
    } else {
      await ttDeleteProducts(r.cfg, [pid]);
      // Xóa hẳn khỏi bảng local để không còn hiện trong list (TikTok chuyển sang DELETED).
      await db.delete(schema.tiktokProducts).where(eq(schema.tiktokProducts.id, r.row.id));
    }
    return NextResponse.json({ ok: true, action });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 });
  }
}
