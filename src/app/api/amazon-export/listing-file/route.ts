import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { buildListingFlatFile } from "@/lib/amazon-listing-file";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/amazon-export/listing-file { ids }   (ids = amazon_products.id)
 * Tải FLAT FILE LISTING (File 1) .txt — "Add Products via Upload", product type DISPLAY_ALBUM.
 * Nội dung build ở src/lib/amazon-listing-file.ts (dùng chung với ⬆ Push to Amazon qua Feeds API).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const res = await buildListingFlatFile(session, b?.ids);
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status });

  // v345 · Tải flat file = đã gửi lên Amazon → đánh dấu DRAFT thành EXPORTED để "Sync from Amazon" nhận (không bị bỏ qua).
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x)));
  if (ids.length) await db.update(schema.amazonProducts).set({ status: "EXPORTED", exportedAt: new Date(), updatedAt: new Date() })
    .where(and(inArray(schema.amazonProducts.id, ids), eq(schema.amazonProducts.status, "DRAFT"))).catch(() => {});

  const fname = `amazon-listings-${new Date().toISOString().slice(0, 10)}.txt`;
  return new NextResponse(res.txt, {
    headers: {
      "Content-Type": "text/tab-separated-values; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "X-Rows": String(res.rows),
      "X-Skipped": String(res.skipped.length),
      "X-Skipped-First": encodeURIComponent(res.skipped[0] ?? ""),
    },
  });
}
