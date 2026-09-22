import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * v572 · PATCH /api/meta-ads/campaigns { campaignId, seller } — gán SELLER cho campaign
 * (chỉ ghi DB FUSION, không đụng Meta). seller rỗng = xoá gán tay → UI quay về tự đoán từ tên.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null) as { campaignId?: string; seller?: string } | null;
  const campaignId = String(b?.campaignId ?? "").trim();
  if (!campaignId) return NextResponse.json({ ok: false, error: "campaignId required" }, { status: 400 });
  const seller = String(b?.seller ?? "").trim().toUpperCase().slice(0, 40) || null;
  await db.insert(schema.metaCampaigns).values({ campaignId, seller, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.metaCampaigns.campaignId, set: { seller, updatedAt: sql`now()` } });
  return NextResponse.json({ ok: true, seller });
}
